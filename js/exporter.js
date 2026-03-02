// ============================================================
// EXCEL EXPORT (ExcelJS)
// ============================================================
import * as S from './state.js';
import { getSortedData } from './dataEngine.js';
import { roundPrice } from './parser.js';
import { showToast, downloadBlob, todayStr } from './utils.js';

export async function generateExcel(mode) {
  try {
    let data;
    if (mode === 'myprice')       data = S.groupedData.filter(i => i.isInMyPrice);
    else if (mode === 'current')  data = getSortedData();
    else                          data = S.groupedData;

    /* global ExcelJS */
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Прайс');
    const visibleCols = S.allColumns.filter(c => S.visibleColumns.has(c.key));

    // Headers row
    const headers = ['Штрихкод', 'Наименование', ...visibleCols.map(c => c.displayName)];
    const hRow = ws.addRow(headers);
    hRow.font      = { bold: true };
    hRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    hRow.alignment = { horizontal: 'center', wrapText: true };
    hRow.height    = 45;
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Data rows
    const supplierCols  = visibleCols.filter(c => !c.isMyPrice && !c.metaType && !c.isCustom);
    const supplierFiles = new Set(supplierCols.map(c => c.fileName));

    for (const item of data) {
      const row = [item.barcode, item.names.map(n => n.name).join(' / ')];

      let globalMin = Infinity;
      if (supplierFiles.size >= 2) {
        for (const col of supplierCols) {
          const vals = item.values.get(col.key) || [];
          for (const v of vals) if (v.n > 0 && v.n < globalMin) globalMin = v.n;
        }
      }

      for (const col of visibleCols) {
        if (col.isCustom) {
          row.push((S.customColData[col.key] && S.customColData[col.key][item.barcode]) || '');
          continue;
        }
        const vals = item.values.get(col.key) || [];
        if (vals.length === 0) { row.push(''); continue; }
        const nums = vals.filter(v => v.n !== null).map(v => roundPrice(v.n));
        row.push(nums.length > 0 ? nums.join(' / ') : vals[0].val);
      }

      const dataRow = ws.addRow(row);

      // Synonym rows highlight
      if (item.isSynonym) {
        dataRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F7FF' } };
      }

      // Highlight min prices
      if (supplierFiles.size >= 2 && globalMin < Infinity) {
        let colIdx = 3;
        for (const col of visibleCols) {
          const vals = item.values.get(col.key) || [];
          if (!col.isMyPrice && !col.metaType && !col.isCustom) {
            if (vals.some(v => v.n && Math.abs(roundPrice(v.n) - roundPrice(globalMin)) < 0.01)) {
              dataRow.getCell(colIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
            }
          }
          colIdx++;
        }
      }
    }

    // Column widths
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 40;
    for (let i = 3; i <= headers.length; i++) ws.getColumn(i).width = 16;
    ws.getColumn(1).numFmt = '@';

    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const ds   = todayStr();
    const suffix = mode === 'myprice' ? '-myprice' : mode === 'current' ? '-current' : '';
    downloadBlob(blob, `monitoring${suffix}-${ds}.xlsx`);
    showToast('Excel экспортирован', 'ok');
  } catch(e) {
    alert('Ошибка экспорта: ' + e.message);
  }
}

// ---- Wire up export buttons ----
export function initExporter() {
  document.getElementById('exportAllBtn').addEventListener('click',      () => generateExcel('all'));
  document.getElementById('exportMyPriceBtn').addEventListener('click',  () => generateExcel('myprice'));
  document.getElementById('exportCurrentBtn').addEventListener('click',  () => generateExcel('current'));
}
