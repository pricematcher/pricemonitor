// ============================================================
// TABLE RENDERER (Virtual Scroll)
// ============================================================
import * as S from './state.js';
import { getSortedData, toggleColumn, promptRenameColumn } from './dataEngine.js';
import { roundPrice } from './parser.js';

// ---- Build sticky header ----
function _mvsBuildHeader(visibleCols) {
  const thead = document.getElementById('mainThead');
  let html = '<tr><th style="white-space:nowrap;min-width:140px;"><div class="column-header"><div class="column-header-title">Штрихкод</div></div></th>';
  html += '<th style="min-width:200px;"><div class="column-header"><div class="column-header-title">Наименование</div></div></th>';

  for (const col of visibleCols) {
    const isMeta   = col.metaType;
    const isCustom = col.isCustom;
    const renameBtn = (isMeta || isCustom)
      ? `<button class="col-header-btn" data-rename-key="${col.key}" title="Переименовать">✏️</button>`
      : '';
    const delBtn = isCustom
      ? `<button class="col-header-btn col-header-btn--del" data-remove-custom="${col.key}" title="Удалить">✕</button>`
      : `<button class="col-header-btn col-header-btn--del" data-toggle-col="${col.key}" title="Скрыть колонку">✕</button>`;
    html += `<th title="${col.displayName}" style="min-width:100px;"><div class="column-header">
      <div class="column-file-name">${(isMeta || isCustom) ? '' : col.fileName}</div>
      <div class="column-header-title"><span class="column-name-text">${isMeta ? col.displayName : col.columnName}</span></div>
      <div class="col-header-actions">${renameBtn}${delBtn}</div>
    </div></th>`;
  }
  html += '</tr>';
  thead.innerHTML = html;
}

// ---- Render a single data row ----
function _mvsRenderRow(item, visibleCols) {
  const trClass = item.isSynonym
    ? 'synonym-row group-border-top'
    : (item.isInMyPrice ? 'my-price-row group-border-top' : 'group-border-top');

  const inDB = Object.prototype.hasOwnProperty.call(S.jeDB, item.barcode);

  // Barcode cell
  const bcAddBtn = !inDB
    ? `<button class="bc-add-db-btn" data-open-add-to-db="${item.barcode}" title="Добавить в базу синонимов">＋БД</button>`
    : `<span class="bc-in-db-badge" title="Штрихкод в базе">📚</span>`;
  const bcCell = `<td class="col-barcode" style="white-space:nowrap;"><div class="barcode-cell">
    <span class="barcode-text">${item.barcode}</span>
    <button class="copy-btn" data-copy-bc="${item.barcode}" title="Скопировать штрихкод">📋</button>
    ${bcAddBtn}
  </div></td>`;

  // Name cell
  let nameCell;
  if (S.compactMatches && item.names.length > 1) {
    nameCell = `<td><div class="name-compact">${item.names[0].name} <span>(+${item.names.length - 1})</span></div></td>`;
  } else {
    nameCell = `<td>${item.names.map(n =>
      `<div class="name-item" title="📁 ${n.fileName}"><span class="name-item-label">📁 ${n.fileName}:</span> ${n.name}</div>`
    ).join('')}</td>`;
  }

  // Supplier min price
  const supplierCols  = visibleCols.filter(c => !c.isMyPrice && !c.metaType && !c.isCustom);
  const supplierFiles = new Set(supplierCols.map(c => c.fileName));
  const supplierMinByFile = {};
  for (const fn of supplierFiles) {
    const colsForFile = supplierCols.filter(c => c.fileName === fn);
    let minP = Infinity;
    for (const col of colsForFile) {
      const vals = item.values.get(col.key) || [];
      for (const v of vals) { if (v.n > 0 && v.n < minP) minP = v.n; }
    }
    supplierMinByFile[fn] = minP;
  }
  const globalMinPrice = supplierFiles.size >= 2
    ? Math.min(...Object.values(supplierMinByFile).filter(v => v < Infinity))
    : Infinity;

  // Value cells
  let valueCells = '';
  for (const col of visibleCols) {
    if (col.isCustom) {
      const cv = (S.customColData[col.key] && S.customColData[col.key][item.barcode]) || '';
      valueCells += `<td><div class="custom-cell" data-edit-cell="${item.barcode}" data-edit-col="${col.key}">
        <span class="custom-cell-val">${cv}</span><span class="custom-cell-edit-btn">✎</span>
      </div></td>`;
      continue;
    }
    const vals = item.values.get(col.key) || [];
    if (vals.length === 0) { valueCells += '<td></td>'; continue; }
    const isSupplier = !col.isMyPrice && !col.metaType;
    let inner = '';
    for (const v of vals) {
      let cls = 'price-val';
      let badge = '';
      if (isSupplier && v.n > 0 && supplierFiles.size >= 2) {
        if (Math.abs(v.n - globalMinPrice) < 0.05) cls += ' is-min';
      }
      if (v.autoDivApplied) badge = `<span class="auto-div-badge">🔢</span>`;
      inner += `<div class="value-variant"><span class="${cls}">${v.n !== null ? roundPrice(v.n) : v.val}</span>${badge}</div>`;
    }
    valueCells += `<td><div class="multi-value-container">${inner}</div></td>`;
  }

  return `<tr class="${trClass}">${bcCell}${nameCell}${valueCells}</tr>`;
}

// ---- Render visible rows (virtual scroll) ----
function _mvsRenderVisible() {
  const tbody = document.getElementById('mainTbody');
  if (!tbody) return;
  const visibleCols = S.allColumns.filter(c => S.visibleColumns.has(c.key));
  const total = S._vsData.length;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="${visibleCols.length + 2}" style="padding:24px;text-align:center;color:#888;">Нет данных</td></tr>`;
    return;
  }

  const wrap      = document.getElementById('mainTableWrapper');
  const scrollTop = wrap ? wrap.scrollTop : 0;
  const viewH     = wrap ? wrap.clientHeight : 600;
  const { ROW_H, OVERSCAN } = S.MVS;

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end   = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  const topPad = start * ROW_H;
  const botPad = (total - end) * ROW_H;

  let html = `<tr style="height:${topPad}px;"></tr>`;
  for (let i = start; i < end; i++) html += _mvsRenderRow(S._vsData[i], visibleCols);
  html += `<tr style="height:${botPad}px;"></tr>`;
  tbody.innerHTML = html;
}

// ---- Public: full table render ----
export function renderTable() {
  S.setVsData(getSortedData());
  const visibleCols = S.allColumns.filter(c => S.visibleColumns.has(c.key));
  const container   = document.getElementById('tableContainer');

  if (S._vsData.length === 0 && S.groupedData.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Загрузите прайс-листы для начала работы</div></div>`;
    return;
  }

  if (!document.getElementById('mainTable')) {
    container.innerHTML = `<div class="table-wrapper" id="mainTableWrapper"><table id="mainTable"><thead id="mainThead"></thead><tbody id="mainTbody"></tbody></table></div>`;
    document.getElementById('mainTableWrapper').addEventListener('scroll', () => {
      if (!S.MVS.ticking) {
        requestAnimationFrame(() => { _mvsRenderVisible(); S.MVS.ticking = false; });
        S.MVS.ticking = true;
      }
    });
  }

  _mvsBuildHeader(visibleCols);
  _mvsRenderVisible();
}

// ---- Public: update info counters & button states ----
export function updateUI() {
  const hasData = S.allFilesData.length > 0;
  document.getElementById('productCount').textContent = S.groupedData.length;
  document.getElementById('fileCount').textContent    = S.allFilesData.length;
  document.getElementById('columnCount').textContent  = S.allColumns.filter(c => S.visibleColumns.has(c.key)).length;
  document.getElementById('matchCount').textContent   = S.groupedData.filter(i => i.originalFileCount > 1).length;

  const btns = ['sortMatchesBtn','bigDiffBtn','showMyPriceBtn','maxCoverageBtn',
                 'compactMatchesBtn','exportMyPriceBtn','exportAllBtn','exportCurrentBtn','clearBtn'];
  btns.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !hasData;
  });
}

// ---- Public: update hidden columns panel ----
export function updateHiddenColumnsPanel() {
  const panel = document.getElementById('hiddenColumnsPanel');
  const list  = document.getElementById('hiddenColumnsList');
  const hidden = S.allColumns.filter(c => !S.visibleColumns.has(c.key));
  if (hidden.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'flex';
  list.innerHTML = hidden.map(c =>
    `<button class="restore-column-btn" data-restore-col="${c.key}">↩️ ${c.displayName}</button>`
  ).join('');
}

// ---- Delegate table click events ----
export function initTableDelegation(deps) {
  // deps: { openAddToDB, editCustomCell, removeCustomColumn }
  document.getElementById('tableContainer').addEventListener('click', e => {
    // Copy barcode
    const copyBtn = e.target.closest('[data-copy-bc]');
    if (copyBtn) {
      const bc = copyBtn.dataset.copyBc;
      navigator.clipboard.writeText(bc).then(() => deps.showToast('Скопировано: ' + bc, 'info'));
      return;
    }
    // Add to DB
    const addBtn = e.target.closest('[data-open-add-to-db]');
    if (addBtn) { deps.openAddToDB(addBtn.dataset.openAddToDb); return; }

    // Custom cell edit
    const cellDiv = e.target.closest('[data-edit-cell]');
    if (cellDiv) { deps.editCustomCell(cellDiv.dataset.editCell, cellDiv.dataset.editCol, cellDiv); return; }

    // Toggle column
    const toggleBtn = e.target.closest('[data-toggle-col]');
    if (toggleBtn) {
      toggleColumn(toggleBtn.dataset.toggleCol);
      updateHiddenColumnsPanel();
      renderTable();
      updateUI();
      return;
    }
    // Rename column
    const renameBtn = e.target.closest('[data-rename-key]');
    if (renameBtn) {
      promptRenameColumn(renameBtn.dataset.renameKey);
      renderTable();
      return;
    }
    // Restore hidden column
    const restoreBtn = e.target.closest('[data-restore-col]');
    if (restoreBtn) {
      toggleColumn(restoreBtn.dataset.restoreCol);
      updateHiddenColumnsPanel();
      renderTable();
      updateUI();
      return;
    }
    // Remove custom column
    const removeBtn = e.target.closest('[data-remove-custom]');
    if (removeBtn) { deps.removeCustomColumn(removeBtn.dataset.removeCustom); return; }
  });
}
