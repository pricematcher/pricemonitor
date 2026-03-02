// ============================================================
// FILE PARSING & COLUMN DETECTION
// ============================================================
import { BARCODE_SYNONYMS, NAME_SYNONYMS, MY_PRICE_FILE_NAME, PRICE_DECIMALS } from './constants.js';

// ---- Number parsing ----
export function parsePriceNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).replace(/[^0-9.,\-]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function roundPrice(n) {
  return Math.round(n * Math.pow(10, PRICE_DECIMALS)) / Math.pow(10, PRICE_DECIMALS);
}

// ---- Extract pack quantity from name ----
export function extractPackQtyFromName(name) {
  if (!name) return null;
  const m = String(name).match(/(\d{1,6})\s*(?:шт|штук)(?=[^0-9A-Za-zА-Яа-яёЁ]|$)/i);
  if (m) { const n = parseInt(m[1]); return n > 1 ? n : null; }
  return null;
}

// ---- Column auto-detection ----
export function detectFileCols(fileData) {
  const cols = fileData.data.length > 0 ? Object.keys(fileData.data[0]) : [];
  let _bcCol   = cols[0] || null;
  let _nameCol = cols[1] || cols[0] || null;

  for (const c of cols) {
    if (BARCODE_SYNONYMS.some(s => c.toLowerCase().includes(s.toLowerCase()))) {
      _bcCol = c;
      break;
    }
  }
  for (const c of cols) {
    if (c === _bcCol) continue;
    if (NAME_SYNONYMS.some(s => c.toLowerCase().includes(s.toLowerCase()))) {
      _nameCol = c;
      break;
    }
  }
  return { _bcCol, _nameCol };
}

// ---- CSV parsing (PapaParse) ----
export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    /* global Papa */
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: r => resolve(r.data),
      error:    err => reject(err)
    });
  });
}

// ---- Excel parsing (SheetJS) ----
export async function parseExcel(file) {
  const buf = await file.arrayBuffer();
  /* global XLSX */
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
}

// ---- Unified file parser ----
export async function parseFile(file, fileName) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const data = ext === 'csv' ? await parseCSV(file) : await parseExcel(file);
  return { fileName, data, isMyPrice: fileName === MY_PRICE_FILE_NAME };
}
