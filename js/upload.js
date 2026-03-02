// ============================================================
// FILE UPLOAD HANDLERS
// ============================================================
import * as S from './state.js';
import { parseFile } from './parser.js';
import { autoDetectColumns, processData, rebuildBarcodeAliasFromJeDB } from './dataEngine.js';
import { renderTable, updateUI, updateHiddenColumnsPanel } from './tableRenderer.js';
import { jeRenderEditor, jeDBNotifyChange } from './synonymEditor.js';
import { brandRender } from './brands.js';
import { showToast } from './utils.js';

// ---- Core: rebuild everything after any file change ----
export function processAllData() {
  S.setAllFilesData([]);
  if (S.myPriceData) S.allFilesData.push(S.myPriceData);
  S.allFilesData.push(...S.competitorFilesData);
  autoDetectColumns();
  processData();
  updateHiddenColumnsPanel();
  renderTable();
  updateUI();
  if (S.allFilesData.length > 0) {
    showToast(`✅ Загружено ${S.groupedData.length} товаров из ${S.allFilesData.length} файлов`, 'ok');
  }
}

// ---- Init upload event listeners ----
export function initUpload() {

  // My Price
  document.getElementById('myPriceInput').addEventListener('change', async e => {
    const file   = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('myPriceStatus');
    try {
      status.className   = 'upload-status upload-status--idle';
      status.textContent = '⏳ Загрузка...';
      S.setMyPriceData(await parseFile(file, S.MY_PRICE_FILE_NAME || '🏷️ Мой прайс'));
      status.className   = 'upload-status upload-status--ok';
      status.textContent = `✅ ${file.name}`;
      processAllData();
    } catch(err) {
      status.className   = 'upload-status upload-status--error';
      status.textContent = `❌ Ошибка: ${err.message}`;
      showToast('Ошибка загрузки файла: ' + err.message, 'err');
    }
  });

  // Competitor files
  document.getElementById('competitorInput').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const status = document.getElementById('competitorStatus');
    try {
      status.className   = 'upload-status upload-status--idle';
      status.textContent = '⏳ Загрузка...';
      const parsed = await Promise.all(files.map(f => parseFile(f, f.name.replace(/\.[^.]+$/, ''))));
      S.competitorFilesData.push(...parsed);
      status.className   = 'upload-status upload-status--ok';
      status.textContent = `✅ ${S.competitorFilesData.length} файл(а): ${S.competitorFilesData.map(f => f.fileName).join(', ')}`;
      processAllData();
    } catch(err) {
      status.className   = 'upload-status upload-status--error';
      status.textContent = `❌ Ошибка: ${err.message}`;
      showToast('Ошибка загрузки файла: ' + err.message, 'err');
    }
  });

  // Synonyms JSON
  document.getElementById('synonymsInput').addEventListener('change', async e => {
    const file   = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('synonymsStatus');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.barcodes !== undefined || data.brands !== undefined) {
        if (data.barcodes) S.setJeDB(data.barcodes);
        if (data.brands)   S.setBrandDB(data.brands);
      } else {
        S.setJeDB(data);
      }
      rebuildBarcodeAliasFromJeDB();
      brandRender();
      jeRenderEditor();
      status.className   = 'upload-status upload-status--ok';
      const bcCount = Object.keys(S.jeDB).length;
      const brCount = Object.keys(S._brandDB).length;
      status.textContent = `✅ ${bcCount} групп ШК + ${brCount} брендов`;
      if (S.allFilesData.length > 0) processAllData();
      showToast(`Синонимы загружены: ${bcCount} ШК-групп, ${brCount} брендов`, 'ok');
    } catch(err) {
      status.className   = 'upload-status upload-status--error';
      status.textContent = `❌ Ошибка: ${err.message}`;
      showToast('Ошибка загрузки синонимов: ' + err.message, 'err');
    }
  }, true);
}
