// ============================================================
// MATCHER — UI + Web Worker orchestration
// ============================================================
import * as S from './state.js';
import { showToast } from './utils.js';
import { jePushUndo, jeDBNotifyChange, jeRenderEditor } from './synonymEditor.js';
import { brandNormKey, brandRender } from './brands.js';
import { unifiedMarkUnsaved } from './synonymEditor.js';

let _matcherWorker = null;
let _allMatchPairs = [];
let _matchConfirmPair = null;

// ---- Helpers ----
export function getUnpairedItems() {
  if (!S.myPriceData) return [];
  const bcCol   = S.myPriceData._bcCol;
  const nameCol = S.myPriceData._nameCol;
  const pairedBarcodes = new Set(_allMatchPairs.flatMap(p => [p.a.barcode, p.b.barcode]));
  return S.myPriceData.data
    .map(row => ({ barcode: String(row[bcCol] || '').trim(), name: String(row[nameCol] || '') }))
    .filter(r => r.name && !pairedBarcodes.has(r.barcode));
}

export function getVisiblePairs() {
  const q = (document.getElementById('matcherSearchInp')?.value || '').toLowerCase();
  return _allMatchPairs.filter(p => {
    if (S._matcherDisabledFiles.has(p.a.fileName) || S._matcherDisabledFiles.has(p.b.fileName)) return false;
    if (S._matchView === 'high')   return p.sim >= 80;
    if (S._matchView === 'med')    return p.sim >= 52 && p.sim < 80;
    if (S._matchView === 'unpaired') return false;
    if (q) return p.a.name.toLowerCase().includes(q) || p.b.name.toLowerCase().includes(q);
    return true;
  });
}

// ---- Stats ----
function updateMatcherStats() {
  const high     = _allMatchPairs.filter(p => p.sim >= 80).length;
  const med      = _allMatchPairs.filter(p => p.sim >= 52 && p.sim < 80).length;
  const unpaired = getUnpairedItems().length;
  document.getElementById('statAll').textContent      = _allMatchPairs.length;
  document.getElementById('statHigh').textContent     = high;
  document.getElementById('statMed').textContent      = med;
  document.getElementById('statUnpaired').textContent = unpaired;
}

// ---- Render table ----
export function renderMatcherTable() {
  const chipsPanel = document.getElementById('matcherFilesPanel');
  const fileNames  = [...new Set(S.allFilesData.map(f => f.fileName))];
  chipsPanel.innerHTML = fileNames.map(fn =>
    `<span class="file-chip${S._matcherDisabledFiles.has(fn) ? ' disabled' : ''}" data-matcher-file="${encodeURIComponent(fn)}">${fn}</span>`
  ).join('');

  const wrap = document.getElementById('matcherTableWrap');
  if (S._matchView === 'unpaired') {
    const items  = getUnpairedItems();
    const panel  = document.getElementById('matcherUnpairedPanel');
    panel.style.display = '';
    panel.innerHTML = items.length === 0
      ? '<div style="color:#888;padding:12px;">Все товары имеют пары 🎉</div>'
      : items.map(it => `<div class="unpaired-item">
          <span style="font-family:monospace;font-size:11px;color:#888;">${it.barcode}</span>
          <span>${it.name}</span>
        </div>`).join('');
    wrap.innerHTML = '';
    return;
  }

  document.getElementById('matcherUnpairedPanel').style.display = 'none';
  let pairs = getVisiblePairs();
  if (S._matchHideKnown) {
    pairs = pairs.filter(p =>
      !S.barcodeAliasMap.get(p.a.barcode) || !S.barcodeAliasMap.get(p.b.barcode) ||
      S.barcodeAliasMap.get(p.a.barcode) !== S.barcodeAliasMap.get(p.b.barcode)
    );
  }

  if (pairs.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">${
      _allMatchPairs.length === 0 ? 'Нажмите «Запустить матчинг»' : 'Нет пар в этой категории'
    }</div></div>`;
    return;
  }

  let html = `<table id="matcherTable"><thead><tr>
    <th>#</th><th>%</th><th>Источник А</th><th>Наименование А</th><th>ШК А</th>
    <th>Источник Б</th><th>Наименование Б</th><th>ШК Б</th><th></th>
  </tr></thead><tbody>`;
  pairs.slice(0, 500).forEach((p, idx) => {
    const simCls = p.sim >= 80 ? 'sim-high' : p.sim >= 60 ? 'sim-med' : 'sim-low';
    html += `<tr class="mp-a">
      <td>${idx+1}</td>
      <td class="sim-badge ${simCls}">${p.sim}%</td>
      <td style="font-size:11px;color:#888;">${p.a.fileName}</td>
      <td>${p.a.name}</td>
      <td style="font-family:monospace;font-size:11px;">${p.a.barcode}</td>
      <td style="font-size:11px;color:#888;">${p.b.fileName}</td>
      <td>${p.b.name}</td>
      <td style="font-family:monospace;font-size:11px;">${p.b.barcode}</td>
      <td><button class="match-plus-btn" data-match-idx="${idx}">+</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// ---- Run matcher worker ----
export function runMatcher() {
  if (S.allFilesData.length < 2) { showToast('Загрузите минимум 2 файла прайсов', 'warn'); return; }
  if (_matcherWorker) { _matcherWorker.terminate(); _matcherWorker = null; }

  const progress = document.getElementById('matcherProgress');
  const bar      = document.getElementById('matcherProgressBar');
  const text     = document.getElementById('matcherProgressText');
  progress.style.display = '';
  bar.style.width = '0%';
  text.textContent = 'Запуск матчинга...';

  // Build brand maps
  const bsynArr = [], bantArr = [];
  for (const [canon, b] of Object.entries(S._brandDB)) {
    for (const s of (b.synonyms || [])) { bsynArr.push([s, canon]); }
    for (const a of (b.antonyms || [])) { bantArr.push([canon, a]); bantArr.push([a, canon]); }
  }

  const files = S.allFilesData.map(fd => ({
    fileName: fd.fileName,
    items: fd.data.map(row => ({
      barcode: String(row[fd._bcCol] || '').trim().replace(/\.0+$/, ''),
      name:    String(row[fd._nameCol] || '')
    })).filter(r => r.name)
  }));

  // Load worker from file
  _matcherWorker = new Worker(new URL('../worker/matcher.worker.js', import.meta.url));
  _matcherWorker.postMessage({ files, bsynArr, bantArr });

  _matcherWorker.onmessage = e => {
    if (e.data.type === 'progress') {
      const pct = Math.round(e.data.done / e.data.total * 100);
      bar.style.width = pct + '%';
      text.textContent = `Обработано ${e.data.done} из ${e.data.total}...`;
    } else if (e.data.type === 'done') {
      progress.style.display = 'none';
      _allMatchPairs = e.data.pairs;
      renderMatcherTable();
      updateMatcherStats();
      showToast(`Матчинг завершён: найдено ${_allMatchPairs.length} пар`, 'ok');
      _matcherWorker = null;
    }
  };
}

// ---- Match Confirm Modal ----
export function openMatchConfirm(idx) {
  const pairs = getVisiblePairs();
  _matchConfirmPair = pairs[idx];
  if (!_matchConfirmPair) return;
  const { a, b, sim } = _matchConfirmPair;
  const simCls = sim >= 80 ? 'sim-high' : sim >= 60 ? 'sim-med' : 'sim-low';
  document.getElementById('mcSimInfo').innerHTML = `Сходство: <span class="sim-badge ${simCls}">${sim}%</span>`;
  document.getElementById('mcPairsTable').innerHTML = `
    <tr><td class="label-cell">Товар А</td><td>${a.name}</td><td style="font-family:monospace;font-size:11px;">${a.barcode}</td><td style="color:#888;font-size:11px;">${a.fileName}</td></tr>
    <tr><td class="label-cell">Товар Б</td><td>${b.name}</td><td style="font-family:monospace;font-size:11px;">${b.barcode}</td><td style="color:#888;font-size:11px;">${b.fileName}</td></tr>`;
  const tokensAB = (a.name + ' ' + b.name).toLowerCase().split(/\s+/).filter(t => t.length > 2);
  document.getElementById('mcbSuggestions').textContent = 'Токены: ' + [...new Set(tokensAB)].slice(0, 10).join(', ');
  mcSwitchTab('syn');
  document.getElementById('matchConfirmModal').classList.add('open');
}

export function closeMatchConfirmModal() {
  document.getElementById('matchConfirmModal').classList.remove('open');
  _matchConfirmPair = null;
}

export function mcSwitchTab(tab) {
  document.getElementById('mcTabSyn').classList.toggle('active', tab === 'syn');
  document.getElementById('mcTabBrand').classList.toggle('active', tab === 'brand');
  document.getElementById('mcPaneSyn').classList.toggle('active', tab === 'syn');
  document.getElementById('mcPaneBrand').classList.toggle('active', tab === 'brand');
}

export function confirmMatchAction() {
  if (!_matchConfirmPair) return;
  const { a, b } = _matchConfirmPair;
  jePushUndo();
  const bcA  = a.barcode, bcB = b.barcode;
  const keyA = Object.keys(S.jeDB).find(k => k === bcA || S.jeDB[k].slice(1).includes(bcA));
  const keyB = Object.keys(S.jeDB).find(k => k === bcB || S.jeDB[k].slice(1).includes(bcB));

  if (keyA && keyB && keyA !== keyB) {
    const merged = [...new Set([...S.jeDB[keyA], ...S.jeDB[keyB].slice(1), keyB])];
    S.jeDB[keyA] = merged;
    delete S.jeDB[keyB];
  } else if (keyA) {
    if (!S.jeDB[keyA].includes(bcB)) S.jeDB[keyA].push(bcB);
  } else if (keyB) {
    if (!S.jeDB[keyB].includes(bcA)) S.jeDB[keyB].push(bcA);
  } else {
    S.jeDB[bcA] = [a.name || bcA, bcB];
  }

  jeDBNotifyChange();
  jeRenderEditor();
  closeMatchConfirmModal();
  showToast('Связь создана', 'ok');
}

// ---- Init matcher event listeners ----
export function initMatcher(deps) {
  // deps: { renderTable }

  document.getElementById('matcherRunBtn').addEventListener('click', runMatcher);

  document.getElementById('matcherHideKnownBtn').addEventListener('click', () => {
    S.setMatchHideKnown(!S._matchHideKnown);
    document.getElementById('matcherHideKnownBtn').classList.toggle('active', S._matchHideKnown);
    renderMatcherTable();
  });

  document.getElementById('matcherSearchInp').addEventListener('input', renderMatcherTable);

  // Stats filter
  document.querySelectorAll('.mstat').forEach(el => {
    el.addEventListener('click', () => {
      S.setMatchView(el.dataset.mv);
      document.querySelectorAll('.mstat').forEach(m => m.classList.toggle('active', m.dataset.mv === S._matchView));
      document.getElementById('matcherUnpairedPanel').style.display = S._matchView === 'unpaired' ? '' : 'none';
      renderMatcherTable();
    });
  });

  // File chip toggle (delegated)
  document.getElementById('matcherFilesPanel').addEventListener('click', e => {
    const chip = e.target.closest('[data-matcher-file]');
    if (!chip) return;
    const fn = decodeURIComponent(chip.dataset.matcherFile);
    if (S._matcherDisabledFiles.has(fn)) S._matcherDisabledFiles.delete(fn);
    else S._matcherDisabledFiles.add(fn);
    renderMatcherTable();
  });

  // Match table: open confirm
  document.getElementById('matcherTableWrap').addEventListener('click', e => {
    const btn = e.target.closest('[data-match-idx]');
    if (btn) openMatchConfirm(parseInt(btn.dataset.matchIdx));
  });

  // Match confirm modal
  document.getElementById('mcOkBtn').addEventListener('click', () => {
    confirmMatchAction();
    deps.renderTable();
  });

  document.getElementById('mcbSaveBtn').addEventListener('click', () => {
    const key  = brandNormKey(document.getElementById('mcbCanon').value);
    if (!key) { showToast('Введите бренд', 'warn'); return; }
    const syns = document.getElementById('mcbSyns').value.split(/[\n,]/).map(brandNormKey).filter(Boolean);
    const anti = document.getElementById('mcbAnti').value.split(/[\n,]/).map(brandNormKey).filter(Boolean);
    S._brandDB[key] = { synonyms: syns, antonyms: anti };
    brandRender();
    unifiedMarkUnsaved(true);
    closeMatchConfirmModal();
    showToast('Бренд сохранён', 'ok');
  });
}
