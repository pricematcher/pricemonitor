// ============================================================
// MODALS & INLINE EDIT HELPERS
// ============================================================
import * as S from './state.js';
import { showToast, jeConfirmDialog } from './utils.js';
import { jePushUndo, jeDBNotifyChange } from './synonymEditor.js';
import { renderTable, updateUI } from './tableRenderer.js';
import { jeRenderEditor } from './synonymEditor.js';
import { brandRender } from './brands.js';
import { unifiedMarkUnsaved } from './synonymEditor.js';

// ---- BC Add to DB Modal ----
let _bcAddTarget = null;

export function openAddToDB(barcode) {
  if (Object.prototype.hasOwnProperty.call(S.jeDB, barcode)) {
    showToast('Штрихкод уже есть в базе', 'warn');
    return;
  }
  _bcAddTarget = barcode;
  document.getElementById('bcMainInput').value = barcode;
  const item = S.groupedData.find(i => i.barcode === barcode);
  document.getElementById('bcNameInput').value = item ? (item.names[0]?.name || '') : '';

  const list = document.getElementById('bcSynonymsList');
  list.innerHTML = '';
  if (item) {
    const otherBCs = [];
    item.originalBarcodesByFile.forEach((bc, fn) => { if (bc !== barcode) otherBCs.push({ bc, fn }); });
    for (const { bc, fn } of otherBCs) {
      const d = document.createElement('div');
      d.className = 'bc-list-item';
      d.innerHTML = `<input type="checkbox" id="bcs_${bc}" value="${bc}"><label for="bcs_${bc}" style="font-family:monospace;">${bc}</label> <span style="color:#888;font-size:11px;">(${fn})</span>`;
      list.appendChild(d);
    }
  }
  document.getElementById('bcAddModal').classList.add('open');
}

export function closeBcAddModal() {
  document.getElementById('bcAddModal').classList.remove('open');
  _bcAddTarget = null;
}

export function saveBcAddModal() {
  const main    = document.getElementById('bcMainInput').value;
  const name    = document.getElementById('bcNameInput').value || main;
  const checked = Array.from(document.querySelectorAll('#bcSynonymsList input:checked')).map(i => i.value);
  jePushUndo();
  S.jeDB[main] = [name, ...checked];
  jeDBNotifyChange();
  closeBcAddModal();
  renderTable();
  showToast(`Добавлено: ${main} с ${checked.length} синонимами`, 'ok');
}

// ---- Custom cell inline edit ----
export function editCustomCell(barcode, colKey, el) {
  const span = el.querySelector('.custom-cell-val');
  const cur  = span ? span.textContent : '';
  const inp  = document.createElement('input');
  inp.className = 'custom-cell-input';
  inp.value     = cur;
  el.innerHTML  = '';
  el.appendChild(inp);
  inp.focus();

  const save = () => {
    const v = inp.value;
    if (!S.customColData[colKey]) S.customColData[colKey] = {};
    S.customColData[colKey][barcode] = v;
    el.innerHTML = `<span class="custom-cell-val">${v}</span><span class="custom-cell-edit-btn">✎</span>`;
  };
  inp.addEventListener('blur', save);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { save(); }
    if (e.key === 'Escape') {
      el.innerHTML = `<span class="custom-cell-val">${cur}</span><span class="custom-cell-edit-btn">✎</span>`;
    }
  });
}

// ---- Remove custom column ----
export function removeCustomColumn(key) {
  const idx = S.customColumns.findIndex(c => c.key === key);
  if (idx !== -1) S.customColumns.splice(idx, 1);
  S.visibleColumns.delete(key);
  delete S.customColData[key];
  renderTable();
  updateUI();
}

// ---- Copy barcode ----
export function copyBarcode(bc) {
  navigator.clipboard.writeText(bc).then(() => showToast('Скопировано: ' + bc, 'info'));
}

// ---- Clear all data ----
export function initClearAll() {
  document.getElementById('clearBtn').onclick = async () => {
    const ok = await jeConfirmDialog('Это сбросит все данные, включая базу синонимов. Продолжить?', 'Сбросить всё');
    if (!ok) return;

    S.setMyPriceData(null);
    S.setCompetitorFilesData([]);
    S.setAllFilesData([]);
    S.setGroupedData([]);
    S.setAllColumns([]);
    S.visibleColumns.clear();
    S.setBarcodeColumn(null);
    S.setNameColumn(null);
    S.setStockColumn(null);
    S.setTransitColumn(null);
    S.setSortMode('default');
    S.setSearchQuery('');
    S.setCompactMatches(false);
    S.setFilterNewItems(false);
    S.barcodeAliasMap.clear();
    S.setSynonymsLoaded(false);
    S.setJeDB({});
    S.setBrandDB({});
    S.setJeUndoStack([]);
    S.setJeRedoStack([]);
    S.setVsData([]);

    document.getElementById('myPriceStatus').className   = 'upload-status upload-status--idle';
    document.getElementById('myPriceStatus').textContent = 'Файл не загружен';
    document.getElementById('competitorStatus').className   = 'upload-status upload-status--idle';
    document.getElementById('competitorStatus').textContent = 'Файлы не загружены';
    document.getElementById('synonymsStatus').className   = 'upload-status upload-status--idle';
    document.getElementById('synonymsStatus').textContent = 'Файл не загружен';
    document.getElementById('tableContainer').innerHTML   =
      `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Загрузите прайс-листы для начала работы</div></div>`;
    document.getElementById('hiddenColumnsPanel').style.display = 'none';

    ['sortMatchesBtn','bigDiffBtn','showMyPriceBtn','maxCoverageBtn','compactMatchesBtn',
     'exportMyPriceBtn','exportAllBtn','exportCurrentBtn','clearBtn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.disabled = true; el.classList.remove('active'); }
    });
    ['productCount','fileCount','columnCount','matchCount'].forEach(id => {
      document.getElementById(id).textContent = '0';
    });

    jeRenderEditor();
    brandRender();
    unifiedMarkUnsaved(false);
    showToast('Все данные сброшены', 'info');
  };
}

// ---- Expose globals for inline HTML onclick calls ----
export function exposeGlobals() {
  window.closeBcAddModal        = closeBcAddModal;
  window.saveBcAddModal         = saveBcAddModal;
  window.closeBrandEditModal    = () => document.getElementById('brandEditModal').classList.remove('open');
  window.closeBrandAddModal     = () => document.getElementById('brandAddModal').classList.remove('open');
  window.closeMatchConfirmModal = () => {
    document.getElementById('matchConfirmModal').classList.remove('open');
  };
  window.jeXlsModalClose = (mode) => {
    // Imported dynamically to avoid circular deps
    import('./synonymEditor.js').then(m => m.jeXlsModalClose(mode));
  };
  window.mcSwitchTab = (tab) => {
    import('./matcher.js').then(m => m.mcSwitchTab(tab));
  };
  window.confirmMatchAction = () => {
    import('./matcher.js').then(m => { m.confirmMatchAction(); renderTable(); });
  };
  window.brandSaveEdit = () => {
    import('./brands.js').then(m => m.brandSaveEdit());
  };
}
