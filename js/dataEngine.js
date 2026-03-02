// ============================================================
// DATA ENGINE — column detection, data processing, filtering
// ============================================================
import {
  MY_PRICE_FILE_NAME, META_STOCK_KEY, META_TRANSIT_KEY,
  STOCK_COL_SYNONYMS, TRANSIT_COL_SYNONYMS
} from './constants.js';
import { detectFileCols, parsePriceNumber, roundPrice, extractPackQtyFromName } from './parser.js';
import * as S from './state.js';

// ---- Barcode alias map ----
export function canonicalizeBarcode(rawBarcode) {
  if (rawBarcode === null || rawBarcode === undefined) return { canonical: '', wasSynonym: false };
  let b = String(rawBarcode).trim().replace(/\.0+$/, '');
  if (!S.synonymsLoaded) return { canonical: b, wasSynonym: false };
  const canon = S.barcodeAliasMap.get(b);
  if (canon && canon !== b) return { canonical: canon, wasSynonym: true };
  return { canonical: b, wasSynonym: false };
}

export function rebuildBarcodeAliasFromJeDB() {
  S.barcodeAliasMap.clear();
  for (const [mainBC, valArr] of Object.entries(S.jeDB)) {
    S.barcodeAliasMap.set(mainBC, mainBC);
    for (let i = 1; i < valArr.length; i++) {
      S.barcodeAliasMap.set(String(valArr[i]).trim(), mainBC);
    }
  }
  S.setSynonymsLoaded(true);
  const badge = document.getElementById('bcCountBadge');
  if (badge) badge.textContent = Object.keys(S.jeDB).length;
}

// ---- Column auto-detection ----
export function autoDetectColumns() {
  S.setAllColumns([]);
  S.visibleColumns.clear();
  S.setStockColumn(null);
  S.setTransitColumn(null);

  if (S.allFilesData.length === 0) return;

  const firstFile = S.allFilesData[0];
  const { _bcCol, _nameCol } = detectFileCols(firstFile);
  S.setBarcodeColumn(_bcCol);
  S.setNameColumn(_nameCol);

  // Find stock/transit in myPrice
  if (S.myPriceData) {
    const cols = S.myPriceData.data.length > 0 ? Object.keys(S.myPriceData.data[0]) : [];
    for (const c of cols) {
      if (!S.stockColumn && STOCK_COL_SYNONYMS.some(s => c.toLowerCase().includes(s))) S.setStockColumn(c);
      if (!S.transitColumn && TRANSIT_COL_SYNONYMS.some(s => c.toLowerCase().includes(s))) S.setTransitColumn(c);
    }
  }

  // Meta columns
  const cols = S.allColumns;
  if (S.stockColumn) {
    cols.push({ fileName: MY_PRICE_FILE_NAME, columnName: S.stockColumn, displayName: 'Остаток', key: META_STOCK_KEY, metaType: 'stock' });
    S.visibleColumns.add(META_STOCK_KEY);
  }
  if (S.transitColumn && S.showTransitColumn) {
    cols.push({ fileName: MY_PRICE_FILE_NAME, columnName: S.transitColumn, displayName: 'В пути', key: META_TRANSIT_KEY, metaType: 'transit' });
    S.visibleColumns.add(META_TRANSIT_KEY);
  }

  // Per-file columns
  for (const fd of S.allFilesData) {
    const { _bcCol, _nameCol } = detectFileCols(fd);
    fd._bcCol   = _bcCol;
    fd._nameCol = _nameCol;
    const fileCols = fd.data.length > 0 ? Object.keys(fd.data[0]) : [];
    for (const c of fileCols) {
      if (c === _bcCol || c === _nameCol) continue;
      if (fd.isMyPrice && (c === S.stockColumn || c === S.transitColumn)) continue;
      const key = `${fd.fileName}|${c}`;
      cols.push({ fileName: fd.fileName, columnName: c, displayName: `${fd.fileName} — ${c}`, key, isMyPrice: fd.isMyPrice });
      S.visibleColumns.add(key);
    }
  }

  // Custom columns
  for (const cc of S.customColumns) {
    cols.push({ fileName: '', columnName: cc.displayName, displayName: cc.displayName, key: cc.key, isCustom: true });
    S.visibleColumns.add(cc.key);
  }

  S.setAllColumns(cols);
}

// ---- Data processing ----
export function processData() {
  const barcodeMap = new Map();

  for (const fd of S.allFilesData) {
    const bcCol   = fd._bcCol   || (fd.data[0] ? Object.keys(fd.data[0])[0] : null);
    const nameCol = fd._nameCol || (fd.data[0] ? Object.keys(fd.data[0])[1] : null);

    for (const row of fd.data) {
      const rawBC = row[bcCol];
      if (!rawBC) continue;
      const { canonical, wasSynonym } = canonicalizeBarcode(rawBC);
      if (!canonical) continue;

      if (!barcodeMap.has(canonical)) {
        barcodeMap.set(canonical, {
          barcode: canonical,
          names:   [],
          values:  new Map(),
          isInMyPrice: false,
          myPriceOrder: -1,
          filesWithBarcode: new Set(),
          namesByFile: new Map(),
          originalBarcodesByFile: new Map(),
          isSynonym: wasSynonym,
          packQty: null
        });
      }

      const item = barcodeMap.get(canonical);
      item.filesWithBarcode.add(fd.fileName);
      if (wasSynonym) item.isSynonym = true;

      const nameVal = row[nameCol] || '';
      if (nameVal && !item.namesByFile.has(fd.fileName)) {
        item.namesByFile.set(fd.fileName, nameVal);
        item.names.push({ fileName: fd.fileName, name: nameVal });
        if (fd.isMyPrice && !item.packQty) item.packQty = extractPackQtyFromName(nameVal);
      }

      if (!item.originalBarcodesByFile.has(fd.fileName)) {
        item.originalBarcodesByFile.set(fd.fileName, String(rawBC).trim().replace(/\.0+$/, ''));
      }

      if (fd.isMyPrice) {
        item.isInMyPrice = true;
        if (item.myPriceOrder < 0) item.myPriceOrder = fd.data.indexOf(row);
      }

      // Process value columns
      for (const col of S.allColumns) {
        if (col.fileName !== fd.fileName) continue;

        if (col.metaType === 'stock' && fd.isMyPrice) {
          const v = row[S.stockColumn];
          if (!item.values.has(META_STOCK_KEY)) item.values.set(META_STOCK_KEY, []);
          item.values.get(META_STOCK_KEY).push({ val: v, rowName: nameVal });
          continue;
        }
        if (col.metaType === 'transit' && fd.isMyPrice) {
          const v = row[S.transitColumn];
          if (!item.values.has(META_TRANSIT_KEY)) item.values.set(META_TRANSIT_KEY, []);
          item.values.get(META_TRANSIT_KEY).push({ val: v, rowName: nameVal });
          continue;
        }
        if (!col.isCustom && col.fileName === fd.fileName) {
          const v = row[col.columnName];
          if (v === undefined || v === '') continue;
          if (!item.values.has(col.key)) item.values.set(col.key, []);
          const existing = item.values.get(col.key);
          const n = parsePriceNumber(v);
          if (n !== null) {
            const rp = roundPrice(n);
            if (!existing.some(e => e.roundedVal === rp)) {
              existing.push({ val: v, rowName: nameVal, n, roundedVal: rp, originalBarcode: rawBC });
            }
          } else {
            existing.push({ val: v, rowName: nameVal, n: null, originalBarcode: rawBC });
          }
        }
      }
    }
  }

  // Convert map to array with coverage/diff stats
  const data = Array.from(barcodeMap.values()).map(item => {
    const coverageCols = S.allColumns.filter(c => !c.isMyPrice && !c.metaType && !c.isCustom && S.visibleColumns.has(c.key));
    const filesWithPrice = new Set();
    for (const col of coverageCols) {
      if (item.values.has(col.key) && item.values.get(col.key).length > 0) filesWithPrice.add(col.fileName);
    }

    let priceDiffPercent = 0;
    const allNums = [];
    for (const col of coverageCols) {
      const vals = item.values.get(col.key) || [];
      for (const v of vals) { if (v.n > 0) allNums.push(v.n); }
    }
    if (allNums.length >= 2) {
      const mn = Math.min(...allNums), mx = Math.max(...allNums);
      if (mn > 0) priceDiffPercent = (mx - mn) / mn * 100;
    }

    return {
      ...item,
      originalFileCount: item.filesWithBarcode.size,
      coverageCount: filesWithPrice.size,
      priceDiffPercent
    };
  });

  S.setGroupedData(data);
}

// ---- Filter & sort ----
export function getSortedData() {
  let data = [...S.groupedData];
  const q = S.searchQuery.trim().toLowerCase();
  if (q) {
    data = data.filter(item =>
      item.names.some(n => n.name.toLowerCase().includes(q)) ||
      item.barcode.toLowerCase().includes(q)
    );
  }
  if (S.filterNewItems) {
    data = data.filter(item => !item.isInMyPrice);
    data.sort((a, b) => b.coverageCount - a.coverageCount);
    return data;
  }
  if (S.sortMode === 'matches') {
    data.sort((a, b) => (b.originalFileCount > 1 ? 1 : 0) - (a.originalFileCount > 1 ? 1 : 0));
  } else if (S.sortMode === 'bigdiff') {
    data = data.filter(i => i.originalFileCount > 1 && i.priceDiffPercent > 10);
    data.sort((a, b) => b.priceDiffPercent - a.priceDiffPercent);
  } else if (S.sortMode === 'myprice') {
    data = data.filter(i => i.isInMyPrice);
    data.sort((a, b) => a.myPriceOrder - b.myPriceOrder);
  }
  return data;
}

// ---- Toggle column visibility ----
export function toggleColumn(key) {
  if (S.visibleColumns.has(key)) S.visibleColumns.delete(key);
  else S.visibleColumns.add(key);
}

// ---- Rename column display name ----
export function promptRenameColumn(key) {
  const col = S.allColumns.find(c => c.key === key);
  if (!col) return;
  const newName = prompt('Новое название колонки:', col.displayName);
  if (newName && newName.trim()) col.displayName = newName.trim();
}
