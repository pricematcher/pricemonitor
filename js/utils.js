/* ============================================================
   utils.js — общие утилиты PriceMonitor
   Экспортирует: window.Utils
   ============================================================ */

window.Utils = (function () {

  /* ── Чтение файлов ─────────────────────────────────────── */

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Ошибка чтения файла: ' + file.name));
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Ошибка чтения файла: ' + file.name));
      reader.readAsText(file, encoding || 'UTF-8');
    });
  }

  /* ── Чтение Excel / CSV ────────────────────────────────── */

  // Читает Excel-файл через SheetJS → массив строк [[col1, col2, ...], ...]
  function readExcel(buffer) {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  }

  // Читает все листы Excel → { sheetName: [[...]], ... }
  function readExcelSheets(buffer) {
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const result = {};
    wb.SheetNames.forEach(name => {
      result[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    });
    return result;
  }

  // Читает CSV через PapaParse — сначала UTF-8, потом windows-1251
  function readCSV(file) {
    return new Promise((resolve, reject) => {
      PapaParse.parse(file, {
        encoding: 'UTF-8',
        header: false,
        skipEmptyLines: true,
        complete: res => {
          if (res.errors.length && res.data.length === 0) {
            // Retry с windows-1251
            PapaParse.parse(file, {
              encoding: 'windows-1251',
              header: false,
              skipEmptyLines: true,
              complete: r => resolve(r.data),
              error: err => reject(new Error(err.message)),
            });
          } else {
            resolve(res.data);
          }
        },
        error: err => reject(new Error(err.message)),
      });
    });
  }

  // Универсальная загрузка файла → массив строк
  async function loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'csv') {
        return await readCSV(file);
      } else {
        const buffer = await readFileAsArrayBuffer(file);
        return readExcel(buffer);
      }
    } catch (err) {
      throw new Error(`Не удалось прочитать "${file.name}": ${err.message}`);
    }
  }

  // Загрузка с возвратом и буфера и данных
  async function loadFileWithBuffer(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'csv') {
        const rows = await readCSV(file);
        return { rows, buffer: null };
      } else {
        const buffer = await readFileAsArrayBuffer(file);
        const rows   = readExcel(buffer);
        return { rows, buffer };
      }
    } catch (err) {
      throw new Error(`Не удалось прочитать "${file.name}": ${err.message}`);
    }
  }

  /* ── Экспорт / скачивание ──────────────────────────────── */

  function downloadBlob(blob, filename) {
    saveAs(blob, filename);
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob(
      [JSON.stringify(obj, null, 2)],
      { type: 'application/json;charset=utf-8' }
    );
    saveAs(blob, filename);
  }

  // Создание XLSX из массива строк через ExcelJS
  async function buildXLSX(rows, headers) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Лист1');
    if (headers && headers.length) {
      const hRow = ws.addRow(headers);
      hRow.font = { bold: true };
      hRow.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFE8F4EE' }
      };
    }
    rows.forEach(r => ws.addRow(r));
    ws.columns.forEach(col => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, cell => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 50);
    });
    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* ── Нормализация штрихкодов ───────────────────────────── */

  function normalizeBarcode(raw) {
    if (raw == null) return '';
    // Строка, убираем пробелы, НЕ убираем ведущие нули
    return String(raw).trim().replace(/\s+/g, '');
  }

  // Поиск главного штрихкода в базе синонимов
  // Использует ленивый индекс AppState._barcodeIndex
  function findMainBarcode(rawBarcode) {
    const bc = normalizeBarcode(rawBarcode);
    if (!bc) return null;
    const db = window.AppState && window.AppState.synonyms && window.AppState.synonyms.barcodes;
    if (!db) return null;

    // Прямое совпадение
    if (db[bc]) return bc;

    // Поиск в индексе синонимов
    const index = _getBarcodeIndex();
    return index[bc] || null;
  }

  function _getBarcodeIndex() {
    if (window.AppState._barcodeIndex) return window.AppState._barcodeIndex;
    const index = {};
    const db = (window.AppState.synonyms && window.AppState.synonyms.barcodes) || {};
    for (const [main, arr] of Object.entries(db)) {
      for (let i = 1; i < arr.length; i++) {
        const syn = normalizeBarcode(arr[i]);
        if (syn && !index[syn]) index[syn] = main;
      }
    }
    window.AppState._barcodeIndex = index;
    return index;
  }

  function getProductName(rawBarcode) {
    const main = findMainBarcode(rawBarcode);
    if (!main) return null;
    const arr = window.AppState.synonyms.barcodes[main];
    return (arr && arr[0]) || null;
  }

  function addBarcodeGroup(mainBarcode, productName, synonymBarcodes) {
    const bc  = normalizeBarcode(mainBarcode);
    const syns = (synonymBarcodes || []).map(normalizeBarcode).filter(Boolean);
    const db  = window.AppState.synonyms.barcodes;
    db[bc]    = [productName || '', ...syns];
    window.AppState._barcodeIndex = null; // сброс кэша
    window.AppState.synonyms._updatedAt = _today();
    window.AppState._synonymsDirty = true;
  }

  function addSynonymToBarcode(mainBarcode, synonymBarcode) {
    const main = normalizeBarcode(mainBarcode);
    const syn  = normalizeBarcode(synonymBarcode);
    const db   = window.AppState.synonyms.barcodes;
    if (!db[main] || !syn) return false;
    if (db[main].includes(syn)) return false;
    db[main].push(syn);
    window.AppState._barcodeIndex = null;
    window.AppState._synonymsDirty = true;
    return true;
  }

  /* ── Сопоставление названий колонок ───────────────────── */

  // Возвращает имя шаблона или null
  function matchColumnName(rawHeader) {
    if (!rawHeader) return null;
    const h = String(rawHeader).trim().toLowerCase();
    const synonyms = (window.AppState.config && window.AppState.config.columnSynonyms) || {};

    for (const [templateName, syns] of Object.entries(synonyms)) {
      if (templateName.trim().toLowerCase() === h) return templateName;
      if (Array.isArray(syns) && syns.some(s => s.trim().toLowerCase() === h)) return templateName;
    }
    return null;
  }

  /* ── Форматирование чисел ──────────────────────────────── */

  function formatPrice(value) {
    if (value == null || value === '' || isNaN(value)) return '—';
    return Number(value).toLocaleString('ru-RU', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function parsePrice(str) {
    if (str == null || str === '') return null;
    const s = String(str).replace(',', '.').replace(/[^\d.]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function formatNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('ru-RU');
  }

  /* ── Сохранение конфигов ───────────────────────────────── */

  function saveSynonymsJSON() {
    if (!window.AppState.synonyms) return;
    window.AppState.synonyms._updatedAt = _today();
    downloadJSON(window.AppState.synonyms, 'synonyms.json');
    window.AppState._synonymsDirty = false;
  }

  function saveConfigJSON() {
    if (!window.AppState.config) return;
    window.AppState.config._updatedAt = _today();
    downloadJSON(window.AppState.config, 'user-config.json');
  }

  /* ── Toast уведомления ─────────────────────────────────── */

  let _toastContainer = null;

  function _getToastContainer() {
    if (!_toastContainer) {
      _toastContainer = document.createElement('div');
      _toastContainer.className = 'toast-container';
      document.body.appendChild(_toastContainer);
    }
    return _toastContainer;
  }

  function showToast(message, type, duration) {
    const container = _getToastContainer();
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' toast-' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity .2s, transform .2s';
      setTimeout(() => toast.remove(), 220);
    }, duration || 3000);
  }

  function showSuccess(msg) { showToast(msg, 'success'); }
  function showError(msg)   { showToast(msg, 'error', 4000); }
  function showWarn(msg)    { showToast(msg, 'warn'); }

  /* ── Tooltip глобальный ────────────────────────────────── */

  function initTooltip() {
    const tip = document.createElement('div');
    tip.className = 'app-tooltip';
    tip.id = 'appTooltip';
    document.body.appendChild(tip);

    let current = null;

    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      current = el;
      tip.textContent = el.dataset.tip;
      tip.style.display = 'block';
      _positionTip(tip, el);
    });
    document.addEventListener('mouseout', e => {
      const el = e.target.closest('[data-tip]');
      if (!el) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      tip.style.display = 'none';
      current = null;
    });
    document.addEventListener('mousemove', () => {
      if (current && tip.style.display !== 'none') _positionTip(tip, current);
    });
  }

  function _positionTip(tip, el) {
    const rect = el.getBoundingClientRect();
    const tw = 220, th = tip.offsetHeight || 50;
    const margin = 8;
    const vw = window.innerWidth, vh = window.innerHeight;

    let top  = rect.top - th - 10;
    let left = rect.left + rect.width / 2 - tw / 2;

    if (top < margin) {
      top = rect.bottom + 10;
      tip.style.setProperty('--arrow', 'top');
    } else {
      tip.style.setProperty('--arrow', 'bottom');
    }

    if (left < margin) left = margin;
    if (left + tw > vw - margin) left = vw - tw - margin;
    if (top + th > vh - margin) top = vh - th - margin;

    tip.style.left    = left + 'px';
    tip.style.top     = top  + 'px';
    tip.style.maxWidth = tw  + 'px';
  }

  /* ── Вспомогательные ───────────────────────────────────── */

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFileExt(filename) {
    return filename.split('.').pop().toLowerCase();
  }

  // Проверка что файл допустимого типа
  function isValidFileType(file) {
    return /\.(xlsx|xls|csv)$/i.test(file.name);
  }

  /* ── Публичный API ─────────────────────────────────────── */

  return {
    // Файлы
    readFileAsArrayBuffer,
    readFileAsText,
    readExcel,
    readExcelSheets,
    readCSV,
    loadFile,
    loadFileWithBuffer,

    // Экспорт
    downloadBlob,
    downloadJSON,
    buildXLSX,

    // Штрихкоды
    normalizeBarcode,
    findMainBarcode,
    getProductName,
    addBarcodeGroup,
    addSynonymToBarcode,

    // Колонки
    matchColumnName,

    // Числа
    formatPrice,
    parsePrice,
    formatNum,

    // Конфиги
    saveSynonymsJSON,
    saveConfigJSON,

    // UI
    showToast,
    showSuccess,
    showError,
    showWarn,
    initTooltip,

    // Утилиты
    debounce,
    escapeHtml,
    getFileExt,
    isValidFileType,
  };

})();
