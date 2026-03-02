// ============================================================
// SYNONYM (BARCODE) EDITOR
// ============================================================
import * as S from './state.js';
import { rebuildBarcodeAliasFromJeDB } from './dataEngine.js';
import { showToast, jeConfirmDialog, downloadBlob } from './utils.js';

// ---- Unsaved indicator ----
export function unifiedMarkUnsaved(flag) {
  document.getElementById('unifiedUnsaved').style.display = flag ? 'inline-block' : 'none';
}

// ---- Undo / Redo ----
export function jePushUndo() {
  S.jeUndoStack.push(JSON.stringify(S.jeDB));
  if (S.jeUndoStack.length > 50) S.jeUndoStack.shift();
  S.setJeRedoStack([]);
}

export function jeUndo() {
  if (!S.jeUndoStack.length) return;
  S.jeRedoStack.push(JSON.stringify(S.jeDB));
  S.setJeDB(JSON.parse(S.jeUndoStack.pop()));
  jeDBNotifyChange();
  jeRenderEditor();
  showToast('Отменено', 'info');
}

export function jeRedo() {
  if (!S.jeRedoStack.length) return;
  S.jeUndoStack.push(JSON.stringify(S.jeDB));
  S.setJeDB(JSON.parse(S.jeRedoStack.pop()));
  jeDBNotifyChange();
  jeRenderEditor();
  showToast('Повторено', 'info');
}

// ---- Notify change ----
export function jeDBNotifyChange() {
  rebuildBarcodeAliasFromJeDB();
  unifiedMarkUnsaved(true);
  jeFindDuplicates();
  const badge = document.getElementById('bcCountBadge');
  if (badge) badge.textContent = Object.keys(S.jeDB).length;
}

// ---- Find duplicates ----
export function jeFindDuplicates() {
  const counts = {};
  for (const [k, v] of Object.entries(S.jeDB)) {
    counts[k] = (counts[k] || 0) + 1;
    for (let i = 1; i < v.length; i++) {
      const s = String(v[i]).trim();
      counts[s] = (counts[s] || 0) + 1;
    }
  }
  const dups = Object.keys(counts).filter(k => counts[k] > 1);
  const dupStatus = document.getElementById('jeDupStatus');
  if (dups.length > 0) {
    dupStatus.style.display = 'inline';
    dupStatus.textContent   = `⚠️ Дублей: ${dups.length}`;
  } else {
    dupStatus.style.display = 'none';
  }
  return new Set(dups);
}

// ---- Build one editor row HTML ----
function jeBuildEditorRow(key, idx, dups) {
  const val   = S.jeDB[key];
  const name  = val[0] || '';
  const syns  = val.slice(1);
  const isDupKey = dups.has(key);
  const rowId = 'jer-' + btoa(encodeURIComponent(key)).replace(/[=+/]/g, '_');

  const synHtml = syns.map((s, i) => {
    const isDupSyn = dups.has(String(s).trim());
    return `<span class="syn-wrap${isDupSyn ? ' dup' : ''}">
      <span class="syn-pill">${s}</span>
      <span class="syn-x" data-key="${encodeURIComponent(key)}" data-si="${i+1}">×</span>
    </span>`;
  }).join('');

  return `<tr id="${rowId}">
    <td style="color:#888;font-size:11px;">${idx+1}</td>
    <td><input class="je-inp-cell" value="${name.replace(/"/g,'&quot;')}" data-namekey="${encodeURIComponent(key)}" placeholder="Название"></td>
    <td><input class="je-inp-cell mono${isDupKey ? ' dup-inp' : ''}" value="${key}" data-origkey="${encodeURIComponent(key)}"></td>
    <td><div class="syn-cell">${synHtml}<input class="inp-add-syn" placeholder="+ ШК" data-key="${encodeURIComponent(key)}"></div></td>
    <td><button class="je-del-btn" data-delkey="${encodeURIComponent(key)}" title="Удалить группу">🗑</button></td>
  </tr>`;
}

// ---- Render editor (with virtual scroll for large DBs) ----
export function jeRenderEditor() {
  const q = document.getElementById('jeSearchInp')?.value.toLowerCase() || '';
  const dups = jeFindDuplicates();
  const keys = Object.keys(S.jeDB).filter(k => {
    if (!q) return true;
    return k.toLowerCase().includes(q) ||
      (S.jeDB[k][0] || '').toLowerCase().includes(q) ||
      S.jeDB[k].slice(1).some(s => String(s).toLowerCase().includes(q));
  });

  const total = keys.length;
  const countInfo = document.getElementById('jeCountInfo');
  if (countInfo) countInfo.textContent = `${total} из ${Object.keys(S.jeDB).length}`;

  const tbody = document.getElementById('jeTbody');
  if (!tbody) return;

  if (total <= S.JE_VS_THRESHOLD) {
    tbody.innerHTML = keys.map((k, i) => jeBuildEditorRow(k, i, dups)).join('');
    return;
  }

  // Virtual scroll
  const wrap      = document.getElementById('jeTableWrap');
  const scrollTop = wrap ? wrap.scrollTop : 0;
  const viewH     = wrap ? wrap.clientHeight : 500;
  const { ROW_H, OVERSCAN } = S.JE_VS;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end   = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const topPad = start * ROW_H;
  const botPad = (total - end) * ROW_H;

  let html = `<tr style="height:${topPad}px;"></tr>`;
  for (let i = start; i < end; i++) html += jeBuildEditorRow(keys[i], i, dups);
  html += `<tr style="height:${botPad}px;"></tr>`;
  tbody.innerHTML = html;
}

// ---- Init all event listeners ----
export function initSynonymEditor(deps) {
  // deps: { renderTable }

  // Virtual scroll
  document.getElementById('jeTableWrap').addEventListener('scroll', () => {
    if (Object.keys(S.jeDB).length > S.JE_VS_THRESHOLD) {
      if (!S.JE_VS.ticking) {
        requestAnimationFrame(() => { jeRenderEditor(); S.JE_VS.ticking = false; });
        S.JE_VS.ticking = true;
      }
    }
  });

  // Cell blur
  document.getElementById('jeTbody').addEventListener('blur', e => {
    const t = e.target;
    if (t.dataset.namekey) {
      const key = decodeURIComponent(t.dataset.namekey);
      if (S.jeDB[key]) { jePushUndo(); S.jeDB[key][0] = t.value; jeDBNotifyChange(); }
    }
    if (t.dataset.origkey) {
      const oldKey = decodeURIComponent(t.dataset.origkey);
      const newKey = t.value.trim();
      if (newKey && newKey !== oldKey && S.jeDB[oldKey]) {
        if (S.jeDB[newKey]) { showToast('Такой штрихкод уже существует', 'warn'); t.value = oldKey; return; }
        jePushUndo();
        S.jeDB[newKey] = S.jeDB[oldKey];
        delete S.jeDB[oldKey];
        jeDBNotifyChange();
        jeRenderEditor();
      }
    }
  }, true);

  // Enter key in add-syn input
  document.getElementById('jeTbody').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('inp-add-syn')) {
      const key = decodeURIComponent(e.target.dataset.key);
      const val = e.target.value.trim();
      if (val && S.jeDB[key]) {
        jePushUndo();
        S.jeDB[key].push(val);
        jeDBNotifyChange();
        jeRenderEditor();
        e.target.value = '';
      }
    }
  }, true);

  // Click delegation: remove syn, delete row
  document.getElementById('jeTbody').addEventListener('click', e => {
    if (e.target.classList.contains('syn-x')) {
      const key = decodeURIComponent(e.target.dataset.key);
      const si  = parseInt(e.target.dataset.si);
      if (S.jeDB[key]) { jePushUndo(); S.jeDB[key].splice(si, 1); jeDBNotifyChange(); jeRenderEditor(); }
    }
    if (e.target.classList.contains('je-del-btn')) {
      const key = decodeURIComponent(e.target.dataset.delkey);
      jeConfirmDialog(`Удалить группу «${S.jeDB[key]?.[0] || key}»?`).then(ok => {
        if (ok) { jePushUndo(); delete S.jeDB[key]; jeDBNotifyChange(); jeRenderEditor(); }
      });
    }
  });

  // Search
  document.getElementById('jeSearchInp').addEventListener('input', jeRenderEditor);

  // Create group
  document.getElementById('jeCreateBtn').addEventListener('click', () => {
    const name   = document.getElementById('jeNName').value.trim();
    const mainBC = document.getElementById('jeNMainBC').value.trim();
    const synsRaw = document.getElementById('jeNSyns').value.trim();
    if (!mainBC) { showToast('Введите главный штрихкод', 'warn'); return; }
    if (S.jeDB[mainBC]) { showToast('Штрихкод уже есть в базе', 'warn'); return; }
    const syns = synsRaw ? synsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    jePushUndo();
    S.jeDB[mainBC] = [name || mainBC, ...syns];
    jeDBNotifyChange();
    jeRenderEditor();
    document.getElementById('jeNName').value  = '';
    document.getElementById('jeNMainBC').value = '';
    document.getElementById('jeNSyns').value   = '';
    showToast('Группа создана', 'ok');
  });

  // Undo / Redo buttons
  document.getElementById('jeUndoBtn').addEventListener('click', jeUndo);
  document.getElementById('jeRedoBtn').addEventListener('click', jeRedo);

  // Clear DB
  document.getElementById('jeClearBtn').addEventListener('click', async () => {
    const ok = await jeConfirmDialog('Очистить всю базу штрихкодов?');
    if (!ok) return;
    jePushUndo(); S.setJeDB({}); jeDBNotifyChange(); jeRenderEditor();
    showToast('База штрихкодов очищена', 'warn');
  });

  // Global undo/redo hotkeys
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); jeUndo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); jeRedo(); }
  });

  // Export to Excel
  document.getElementById('jeExportXlsxBtn').addEventListener('click', async () => {
    try {
      /* global ExcelJS */
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Синонимы ШК');
      ws.addRow(['Название', 'Главный ШК', 'Синонимы (через запятую)']);
      ws.getRow(1).font = { bold: true };
      for (const [k, v] of Object.entries(S.jeDB)) {
        ws.addRow([v[0] || '', k, v.slice(1).join(', ')]);
      }
      ws.getColumn(1).width = 40; ws.getColumn(2).width = 20; ws.getColumn(3).width = 50;
      const buf  = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      downloadBlob(blob, 'barcodes.xlsx');
      showToast('База экспортирована в Excel', 'ok');
    } catch(e) { showToast('Ошибка экспорта: ' + e.message, 'err'); }
  });

  // Import from Excel
  document.getElementById('jeImportXlsxBtn').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.xlsx,.xls';
    inp.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const buf  = await file.arrayBuffer();
        /* global XLSX */
        const wb   = XLSX.read(buf, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        const mode = await jeXlsModalOpen();
        if (!mode) return;
        const imported = {};
        for (let i = 1; i < rows.length; i++) {
          const [name, mainBC, synsStr] = rows[i];
          if (!mainBC) continue;
          const syns = synsStr ? String(synsStr).split(',').map(s => s.trim()).filter(Boolean) : [];
          imported[String(mainBC).trim()] = [String(name || ''), ...syns];
        }
        jePushUndo();
        if (mode === 'overwrite') {
          S.setJeDB(imported);
        } else if (mode === 'skip') {
          for (const [k, v] of Object.entries(imported)) { if (!S.jeDB[k]) S.jeDB[k] = v; }
        } else if (mode === 'merge') {
          for (const [k, v] of Object.entries(imported)) {
            if (!S.jeDB[k]) { S.jeDB[k] = v; }
            else { for (let i = 1; i < v.length; i++) { if (!S.jeDB[k].includes(v[i])) S.jeDB[k].push(v[i]); } }
          }
        }
        jeDBNotifyChange();
        jeRenderEditor();
        showToast(`Импортировано ${Object.keys(imported).length} записей`, 'ok');
      } catch(err) { showToast('Ошибка импорта: ' + err.message, 'err'); }
    };
    inp.click();
  });

  // Save unified JSON
  document.getElementById('unifiedSaveJsonBtn').onclick = () => {
    const data = { barcodes: S.jeDB, brands: S._brandDB };
    const json = JSON.stringify(data, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), `synonyms-${_todayStr()}.json`);
    unifiedMarkUnsaved(false);
    showToast('База синонимов сохранена', 'ok');
  };
}

// ---- XLS Import mode modal ----
let _jeXlsResolve = null;

export function jeXlsModalClose(mode) {
  document.getElementById('jeXlsModal').classList.remove('open');
  if (_jeXlsResolve) { _jeXlsResolve(mode); _jeXlsResolve = null; }
}

function jeXlsModalOpen() {
  return new Promise(resolve => {
    _jeXlsResolve = resolve;
    document.getElementById('jeXlsModal').classList.add('open');
  });
}

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
