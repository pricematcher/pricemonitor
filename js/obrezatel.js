/* ============================================================
   obrezatel.js — модуль "Подготовка прайсов"
   Регистрирует: App.registerModule('obrezatel', ObrezatelModule)
   ============================================================ */

window.ObrezatelModule = (function () {

  /* ── Состояние модуля ────────────────────────────────────── */
  let _el        = null; // корневой элемент
  let tableData  = null;
  let selectedColumns = new Map();
  let startRowIndex   = 0;
  let currentWorkbook = null;
  let displayedRows   = 50;
  let activeDropdown  = null;
  let originalFileName = 'export';
  let pendingCsvContent   = null;
  let pendingCsvFileName  = null;
  let pendingSkippedRows  = [];
  let studyMode = false;

  // Complex mode
  let complexModeEnabled = false;
  let complexDetected    = false;
  let currentWs          = null;
  let subheaderGroups    = [];

  // Тип текущего файла в очереди
  let _currentFileType = 'supplier';

  /* ── Шаблоны и синонимы (берём из AppState.config) ─────── */
  function getTemplates() {
    return (AppState.config && AppState.config.columnTemplates) || [];
  }
  function getSynonyms() {
    return (AppState.config && AppState.config.columnSynonyms) || {};
  }

  /* ── Вспомогательные ────────────────────────────────────── */
  function esc(t) {
    return String(t)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }
  function normHeader(n) {
    return String(n||'').toLowerCase().trim()
      .replace(/ё/g,'е').replace(/\s+/g,' ')
      .replace(/[^\p{L}\p{N} ]/gu,'');
  }
  function normalizeBarcode(raw) {
    let s = String(raw ?? '').trim().replace(/\s+/g,'');
    while (s.endsWith('.')) s = s.slice(0,-1);
    if (/^\d+$/.test(s)) return s;
    if (/^\d+\.0$/.test(s)) return s.split('.0')[0];
    const m = s.replace(',','.').match(/^(\d+)(?:\.(\d+))?e\+?(\d+)$/i);
    if (!m) return '';
    const digits = m[1]+(m[2]||''), exp = parseInt(m[3],10), shift = exp-(m[2]||'').length;
    if (shift >= 0) return digits + '0'.repeat(shift);
    const cut = digits.length + shift;
    if (cut <= 0 || !/^0+$/.test(digits.slice(cut))) return '';
    return digits.slice(0, cut);
  }
  function escCsv(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r'))
      return `"${s.replace(/"/g,'""')}"`;
    return s;
  }
  function findBarcodeCol(indices) {
    for (const ci of indices) {
      const n = normHeader(selectedColumns.get(ci)||'');
      if (/штрихкод/.test(n) || /barcode/.test(n) || /\bean\b/.test(n)) return ci;
    }
    return -1;
  }

  /* ── DOM helpers ─────────────────────────────────────────── */
  function $$(sel) { return _el ? _el.querySelector(sel) : null; }

  /* ── Рендер модуля ───────────────────────────────────────── */
  function init(container) {
    _el = container;
    _el.innerHTML = _buildHTML();
    _bindEvents();
    _renderQueueIndicator();
    // Если в AppState есть файлы в очереди — загружаем первый
    if (AppState.queue.files.length > 0 && AppState.queue.current < AppState.queue.files.length) {
      _loadFromAppQueue();
    }
    return { destroy };
  }

  function destroy() {
    _el = null;
    tableData = null;
    selectedColumns.clear();
    currentWorkbook = null;
    activeDropdown = null;
    pendingCsvContent = null;
    studyMode = false;
    complexModeEnabled = false;
    subheaderGroups = [];
  }

  /* ── HTML шаблон ─────────────────────────────────────────── */
  function _buildHTML() {
    return `
<!-- Upload screen -->
<div class="upload-screen" id="ob-uploadScreen">
  <div class="upload-card-main">
    <h1>📊 Подготовка прайсов</h1>
    <p>Загрузите прайсы поставщиков и опционально свой прайс.<br>Файлы обрабатываются по очереди — один за другим.</p>

    <div class="upload-zones">
      <div class="upload-zone upload-zone--supplier" id="ob-supplierZone">
        <div class="upload-zone-icon">📦</div>
        <div class="upload-zone-title">Прайсы поставщиков</div>
        <div class="upload-zone-hint">xlsx, xls, csv<br>Можно выбрать несколько</div>
        <input type="file" id="ob-fileInput" accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.ods,.fods,.txt,.dbf" multiple>
      </div>
      <div class="upload-zone upload-zone--own" id="ob-ownZone">
        <div class="upload-zone-icon">🏠</div>
        <div class="upload-zone-title">Мой прайс <span class="badge-optional">необязательно</span></div>
        <div class="upload-zone-hint">Будет передан в матчер без обработки</div>
        <input type="file" id="ob-ownInput" accept=".xlsx,.xls,.xlsb,.xlsm,.csv">
      </div>
    </div>

    <div id="ob-queuePreview" class="hidden" style="margin-top:12px;text-align:left;"></div>
  </div>
</div>

<!-- Main container (table view) -->
<div class="container" id="ob-tableContainer" style="display:none;">

  <!-- Queue progress bar -->
  <div id="ob-queueBar" class="hidden" style="padding:6px 14px 4px;background:#f9f9f9;border-bottom:1px solid #e0e0e0;">
    <div class="queue-progress"><div class="queue-progress-bar" id="ob-progressBar" style="width:0%"></div></div>
    <span class="queue-progress-label" id="ob-progressLabel"></span>
  </div>

  <!-- Title bar -->
  <div class="xl-titlebar">
    <div class="xl-titlebar-left">
      <span class="xl-title">📊 Подготовка прайсов</span>
      <span class="xl-filename" id="ob-fileNameDisplay"></span>
    </div>
    <div class="xl-titlebar-right">
      <div class="xl-sheets" id="ob-sheetSelector" style="display:none;">
        <span style="font-size:12px;color:rgba(255,255,255,0.8);">Лист:</span>
        <select id="ob-sheetSelect" style="padding:3px 8px;border:1px solid #d0d0d0;border-radius:2px;font-size:12px;background:#fff;"></select>
      </div>
      <input type="file" id="ob-fileInput2" accept=".xlsx,.xls,.xlsb,.xlsm,.csv,.ods,.fods,.txt,.dbf" multiple>
      <label for="ob-fileInput2" class="btn btn-sm" style="background:#2e8b5a;color:#fff;border-color:#1a5c38;cursor:pointer;"
        data-tip="Добавить файл в очередь">
        📂 Открыть другой файл
      </label>
    </div>
  </div>

  <!-- Toolbar -->
  <div class="xl-toolbar">
    <div class="xl-group">
      <button class="xl-btn xl-btn-accent" id="ob-downloadBtn" disabled
        data-tip="Выгрузить выбранные колонки в CSV. Кнопка активна когда выбрана хотя бы одна колонка.">
        <span class="xl-icon">⬇️</span><span>Скачать CSV</span>
      </button>
    </div>
    <div class="xl-toolbar-sep"></div>
    <div class="xl-group">
      <button class="xl-btn" id="ob-resetBtn"
        data-tip="Снять выделение со всех колонок.">
        <span class="xl-icon">↩️</span><span>Сбросить</span>
      </button>
    </div>
    <div class="xl-toolbar-sep"></div>
    <div class="xl-group">
      <button class="xl-btn" id="ob-manageTemplatesBtn"
        data-tip="Редактировать список названий колонок и синонимы для автоопределения.">
        <span class="xl-icon">🏷️</span><span>Названия колонок</span>
      </button>
    </div>
    <div class="xl-toolbar-sep"></div>
    <div class="xl-group" id="ob-complexBtnGroup" style="display:none;">
      <button class="xl-btn" id="ob-complexConfigBtn"
        data-tip="Открыть редактор подзаголовков сложного прайса.">
        <span class="xl-icon">🔍</span><span>Подзаголовки</span>
      </button>
    </div>
    <div class="xl-toolbar-sep" id="ob-complexSep" style="display:none;"></div>
    <div class="xl-group">
      <button class="xl-btn" id="ob-studyModeBtn"
        data-tip="Включить режим обучения: при наведении появятся подсказки.">
        <span class="xl-icon">🎓</span><span>Справка</span>
      </button>
    </div>
  </div>

  <!-- Status bar -->
  <div class="xl-statusbar">
    <div class="xl-stat" data-tip="Всего столбцов в файле">Столбцов: <b id="ob-totalColumns">0</b></div>
    <div class="xl-stat" data-tip="Выбрано для выгрузки">Выбрано: <b id="ob-selectedColumns">0</b></div>
    <div class="xl-stat" data-tip="Строк попадёт в CSV">Строк: <b id="ob-totalRows">0</b></div>
    <div id="ob-queueStatus" style="margin-left:auto;display:none;" class="xl-stat"></div>
  </div>

  <!-- Queue chips -->
  <div id="ob-queuePanel" style="display:none;padding:6px 12px;border-bottom:1px solid #e0e0e0;">
    <div class="xl-queue">
      <div><b>Очередь:</b> <span id="ob-queueCurrent" style="margin-left:6px;"></span></div>
      <div id="ob-queueList" class="queue-chips"></div>
    </div>
  </div>

  <!-- Hint -->
  <div class="xl-hint">
    <b>Как работать:</b> кликните по заголовку столбца — выберите название из списка или введите своё.
    После выбора нажмите «Скачать CSV».
  </div>

  <!-- Complex banner -->
  <div class="complex-banner" id="ob-complexBanner">
    <span>🔶 <b>Сложный прайслист</b> — обнаружены строки-подзаголовки с категориями/брендами.</span>
    <button class="complex-banner-btn" id="ob-complexEnableBtn">Включить режим подзаголовков</button>
    <button class="complex-dismiss" id="ob-complexDismiss" title="Скрыть">✕</button>
  </div>

  <!-- Table -->
  <div class="xl-table-wrap" style="max-height:calc(100vh - 240px);">
    <table id="ob-dataTable"></table>
  </div>

  <!-- Load more -->
  <div id="ob-loadMoreContainer" style="display:none;text-align:center;padding:8px;border-top:1px solid #e0e0e0;background:#f9f9f9;">
    <button class="btn" id="ob-loadMoreBtn"
      data-tip="Показать все строки. По умолчанию отображаются первые 50.">
      Показать все строки (ещё <span id="ob-remainingRows">0</span>)
    </button>
  </div>

</div><!-- /container -->

<!-- Queue complete screen -->
<div id="ob-completeScreen" style="display:none;">
  <div class="queue-complete">
    <div class="queue-complete-icon">✅</div>
    <h2>Все файлы обработаны!</h2>
    <p id="ob-completeSummary"></p>
    <div id="ob-completeErrors" class="queue-errors hidden"></div>
    <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
      <button class="btn btn-primary btn-lg" id="ob-goMatcherBtn">
        ➡️ Перейти в матчер
      </button>
      <button class="btn btn-lg" id="ob-newSessionBtn">
        📂 Загрузить ещё файлы
      </button>
    </div>
    <p class="text-muted text-sm" id="ob-autoNavigate"></p>
  </div>
</div>

<!-- MODAL: Названия колонок -->
<div class="modal-overlay" id="ob-templatesModal" style="display:none;">
  <div class="modal" style="max-width:700px;">
    <div class="modal-header">
      <span>🏷️ Названия колонок</span>
      <button class="btn-close" id="ob-closeTemplatesModal">✕</button>
    </div>
    <div class="modal-body">
      <div class="panel mb-12" style="background:#fff8e1;border-left:3px solid #f0a000;">
        <p style="font-size:13px;line-height:1.6;">
          <b>Как работает:</b> здесь список стандартных названий для колонок.
          У каждого — <b>синонимы</b> для автоопределения при загрузке прайса.<br>
          Изменения сохраняются в <code>data/user-config.json</code> — нажмите
          «💾 Сохранить конфиг» после редактирования.
        </p>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <input id="ob-newTemplateInput" type="text" placeholder="Новое название колонки..." style="flex:1;">
        <button class="btn btn-primary" id="ob-addTemplateBtn">+ Добавить</button>
      </div>
      <div id="ob-templatesList"></div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="ob-closeTemplatesModal2">Закрыть</button>
      <button class="btn btn-primary" id="ob-saveConfigBtn">💾 Сохранить конфиг</button>
    </div>
  </div>
</div>

<!-- MODAL: Пропущенные строки -->
<div class="modal-overlay" id="ob-skippedModal" style="display:none;">
  <div class="modal" style="max-width:700px;">
    <div class="modal-header">
      <span>⚠️ Пропущенные строки</span>
      <button class="btn-close" id="ob-closeSkippedModal">✕</button>
    </div>
    <div class="modal-body">
      <div id="ob-skippedSummary" style="font-size:12px;color:#595959;margin-bottom:6px;"></div>
      <div style="border:1px solid #e0e0e0;overflow:auto;max-height:50vh;background:#fff;margin-top:8px;">
        <table id="ob-skippedTable"></table>
      </div>
      <p style="font-size:12px;color:#737373;margin-top:8px;">CSV будет скачан даже при наличии пропусков.</p>
    </div>
    <div class="modal-footer">
      <button class="btn" id="ob-downloadSkippedBtn">📋 Показать все пропуски</button>
      <button class="btn btn-primary" id="ob-confirmDownloadCsvBtn">⬇️ Скачать CSV</button>
    </div>
  </div>
</div>

<!-- MODAL: Подзаголовки -->
<div class="modal-overlay" id="ob-complexModal" style="display:none;">
  <div class="modal" style="max-width:720px;max-height:85vh;display:flex;flex-direction:column;">
    <div class="modal-header">
      <span>🔍 Настройка подзаголовков</span>
      <button class="btn-close" id="ob-closeComplexModal">✕</button>
    </div>
    <div class="modal-body" style="overflow-y:auto;flex:1;">
      <div class="complex-note">
        <b>Как работает:</b> ниже перечислены все строки-подзаголовки (категории, бренды).
        Кликните по токену, чтобы добавлять его перед наименованием товара.
        Если бренд уже есть в наименовании — он <b>не будет добавлен повторно</b>.
      </div>
      <div id="ob-complexSummaryDiv" class="complex-summary" style="display:none;"></div>
      <div id="ob-complexSubheaderList" class="subheader-list"></div>
      <p id="ob-complexNoData" style="display:none;color:#888;font-size:13px;">
        Подзаголовков не найдено. Убедитесь что выбраны колонки «Штрихкод» и «Наименование».
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn" id="ob-complexResetBtn">↩ Сбросить всё</button>
      <button class="btn btn-primary" id="ob-complexApplyBtn">✓ Применить</button>
    </div>
  </div>
</div>`;
  }

  /* ── Привязка событий ────────────────────────────────────── */
  function _bindEvents() {
    // Upload zones — клик
    const supplierZone = $$('#ob-supplierZone');
    const ownZone      = $$('#ob-ownZone');
    if (supplierZone) supplierZone.addEventListener('click', () => $$('#ob-fileInput').click());
    if (ownZone)      ownZone.addEventListener('click',      () => $$('#ob-ownInput').click());

    // Upload zones — drag & drop
    [['#ob-supplierZone','#ob-fileInput','supplier'], ['#ob-ownZone','#ob-ownInput','own']].forEach(([zoneId, inputId, type]) => {
      const zone = $$(zoneId);
      if (!zone) return;
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files && files.length) _handleUpload(files, type);
      });
    });

    // File inputs
    const fi = $$('#ob-fileInput');
    const fi2 = $$('#ob-fileInput2');
    const oi = $$('#ob-ownInput');
    if (fi)  fi.addEventListener('change',  e => { _handleUpload(e.target.files, 'supplier'); e.target.value=''; });
    if (fi2) fi2.addEventListener('change', e => { _handleUpload(e.target.files, 'supplier'); e.target.value=''; });
    if (oi)  oi.addEventListener('change',  e => { _handleUpload(e.target.files, 'own');      e.target.value=''; });

    // Sheet select
    const ss = $$('#ob-sheetSelect');
    if (ss) ss.addEventListener('change', () => _loadSheet(parseInt(ss.value, 10) || 0));

    // Toolbar
    const downloadBtn = $$('#ob-downloadBtn');
    const resetBtn    = $$('#ob-resetBtn');
    const templatesBtn= $$('#ob-manageTemplatesBtn');
    const loadMoreBtn = $$('#ob-loadMoreBtn');
    const studyBtn    = $$('#ob-studyModeBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', _onDownload);
    if (resetBtn)    resetBtn.addEventListener('click', () => { selectedColumns.clear(); startRowIndex=0; _renderTable(); });
    if (templatesBtn)templatesBtn.addEventListener('click', _openTemplatesModal);
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => { displayedRows = tableData ? tableData.length : displayedRows; _renderTable(); _updateLoadMore(); });
    if (studyBtn)    studyBtn.addEventListener('click', _toggleStudyMode);

    // Complex mode
    const complexEnableBtn = $$('#ob-complexEnableBtn');
    const complexDismiss   = $$('#ob-complexDismiss');
    const complexConfigBtn = $$('#ob-complexConfigBtn');
    if (complexEnableBtn) complexEnableBtn.addEventListener('click', () => _setComplexMode(!complexModeEnabled));
    if (complexDismiss)   complexDismiss.addEventListener('click', () => _showComplexBanner(false));
    if (complexConfigBtn) complexConfigBtn.addEventListener('click', () => { _renderComplexModal(); _showModal('ob-complexModal'); });

    // Modals
    _bindModalClose('ob-templatesModal', 'ob-closeTemplatesModal');
    _bindModalClose('ob-templatesModal', 'ob-closeTemplatesModal2');
    _bindModalClose('ob-skippedModal',   'ob-closeSkippedModal');
    _bindModalClose('ob-complexModal',   'ob-closeComplexModal');

    const saveConfigBtn = $$('#ob-saveConfigBtn');
    if (saveConfigBtn) saveConfigBtn.addEventListener('click', () => { Utils.saveConfigJSON(); Utils.showSuccess('Конфиг сохранён'); });

    const confirmDownloadBtn = $$('#ob-confirmDownloadCsvBtn');
    const downloadSkippedBtn = $$('#ob-downloadSkippedBtn');
    if (confirmDownloadBtn) confirmDownloadBtn.addEventListener('click', _confirmDownloadCsv);
    if (downloadSkippedBtn) downloadSkippedBtn.addEventListener('click', _showAllSkipped);

    const addTemplateBtn = $$('#ob-addTemplateBtn');
    const newTemplateInput = $$('#ob-newTemplateInput');
    if (addTemplateBtn) addTemplateBtn.addEventListener('click', _addTemplate);
    if (newTemplateInput) newTemplateInput.addEventListener('keydown', e => { if (e.key==='Enter') _addTemplate(); });

    // Complex modal buttons
    const complexApplyBtn = $$('#ob-complexApplyBtn');
    const complexResetBtn = $$('#ob-complexResetBtn');
    if (complexApplyBtn) complexApplyBtn.addEventListener('click', () => {
      _hideModal('ob-complexModal');
      const n = subheaderGroups.filter(g => g.selectedTokens.length > 0).length;
      const btn = $$('#ob-complexEnableBtn');
      if (btn) btn.textContent = n > 0 ? `✓ Режим активен (${n} групп) — изменить` : '✓ Режим активен — настроить';
    });
    if (complexResetBtn) complexResetBtn.addEventListener('click', () => {
      subheaderGroups.forEach(g => { g.selectedTokens=[]; g.skipped=false; _autoSelectTokens(g); });
      _renderComplexModal();
    });

    // Complete screen
    const goMatcherBtn  = $$('#ob-goMatcherBtn');
    const newSessionBtn = $$('#ob-newSessionBtn');
    if (goMatcherBtn)  goMatcherBtn.addEventListener('click', () => App.navigate('matcher'));
    if (newSessionBtn) newSessionBtn.addEventListener('click', () => {
      App.queue.reset();
      $$('#ob-completeScreen').style.display = 'none';
      $$('#ob-uploadScreen').style.display   = 'flex';
    });

    // Close dropdown on outside click
    document.addEventListener('click', _onDocClick);
  }

  function _bindModalClose(modalId, btnId) {
    const btn = $$('#' + btnId);
    const modal = $$('#' + modalId);
    if (btn)   btn.addEventListener('click', () => _hideModal(modalId));
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) _hideModal(modalId); });
  }

  function _showModal(id) { const m = $$('#'+id); if (m) m.style.display='flex'; }
  function _hideModal(id) { const m = $$('#'+id); if (m) m.style.display='none'; }

  function _onDocClick(e) {
    if (!activeDropdown) return;
    if (!e.target.closest('.rename-wrapper')) {
      activeDropdown.classList.remove('show');
      activeDropdown = null;
    }
  }

  /* ── Загрузка файлов ─────────────────────────────────────── */
  function _handleUpload(files, type) {
    const arr = Array.from(files).filter(f => Utils.isValidFileType(f));
    if (!arr.length) { Utils.showError('Неподдерживаемый формат файла'); return; }

    if (type === 'own') {
      // Свой прайс — сразу в AppState без обработки
      const file = arr[0];
      Utils.readFileAsArrayBuffer(file).then(buffer => {
        AppState.matcherFiles.own = { name: file.name, buffer };
        App.updateNavStatus();
        Utils.showSuccess(`Мой прайс "${file.name}" добавлен в матчер`);
        _updateQueuePreview();
      });
      return;
    }

    // Прайсы поставщиков — в очередь AppState
    App.queue.add(arr, 'supplier');
    _updateQueuePreview();

    // Если таблица ещё не открыта — загружаем первый файл
    if ($$('#ob-tableContainer').style.display === 'none') {
      _loadFromAppQueue();
    }
  }

  function _updateQueuePreview() {
    const el = $$('#ob-queuePreview');
    if (!el) return;
    const total = AppState.queue.files.length;
    const hasOwn = !!AppState.matcherFiles.own;
    if (total === 0 && !hasOwn) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    let html = '';
    if (total > 0) {
      html += `<div style="font-size:12px;color:#1a5c38;font-weight:600;margin-bottom:4px;">В очереди ${total} файл(ов):</div>`;
      html += '<div class="queue-chips">';
      AppState.queue.files.forEach((item, i) => {
        html += `<span class="queue-chip">${i+1}. ${esc(item.file.name)}</span>`;
      });
      html += '</div>';
    }
    if (hasOwn) {
      html += `<div style="font-size:12px;color:#2d6dbf;margin-top:6px;">🏠 Мой прайс: <b>${esc(AppState.matcherFiles.own.name)}</b></div>`;
    }
    el.innerHTML = html;
  }

  function _loadFromAppQueue() {
    const item = App.queue.current();
    if (!item) { _showCompleteScreen(); return; }
    _currentFileType = item.type;
    originalFileName = item.file.name.replace(/\.[^.]+$/,'');
    _loadFileObject(item.file);
  }

  function _loadFileObject(file) {
    const nameEl = $$('#ob-fileNameDisplay');
    if (nameEl) nameEl.textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      const data = new Uint8Array(e.target.result);
      try {
        currentWorkbook = XLSX.read(data, { type:'array' });
        const ss = $$('#ob-sheetSelector');
        const sel = $$('#ob-sheetSelect');
        if (currentWorkbook.SheetNames.length > 1) {
          sel.innerHTML = '';
          currentWorkbook.SheetNames.forEach((name, idx) => {
            const o = document.createElement('option');
            o.value = String(idx); o.textContent = name;
            sel.appendChild(o);
          });
          ss.style.display = 'flex';
        } else {
          ss.style.display = 'none';
        }
        _loadSheet(0);
        $$('#ob-uploadScreen').style.display  = 'none';
        $$('#ob-tableContainer').style.display = 'block';
        _renderQueueIndicator();
      } catch(err) {
        Utils.showError('Ошибка чтения файла: ' + err.message);
        App.queue.skipWithError(file.name, err.message);
        _loadFromAppQueue();
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ── Лист ────────────────────────────────────────────────── */
  function _loadSheet(idx) {
    if (!currentWorkbook) return;
    const ws = currentWorkbook.Sheets[currentWorkbook.SheetNames[idx]];
    currentWs = ws;
    tableData = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:true });
    startRowIndex = 0; selectedColumns.clear();
    displayedRows = Math.min(50, tableData.length);
    _autoDetectColumns();
    _renderTable();
    _updateLoadMore();
    complexDetected = _detectComplexPricelist(ws);
    subheaderGroups = [];
    if (!complexDetected) {
      _showComplexBanner(false);
      _setComplexMode(false);
    } else {
      _showComplexBanner(true);
    }
  }

  /* ── Авто-определение колонок ────────────────────────────── */
  function _autoDetectColumns() {
    if (!tableData || !tableData.length) return;
    const SCAN = 15;
    const templates = getTemplates();
    const synonyms  = getSynonyms();
    const maxCols = Math.max(0, ...tableData.map(r => r ? r.length : 0));
    for (let col = 0; col < maxCols; col++) {
      if (selectedColumns.has(col)) continue;
      for (let row = 0; row < Math.min(SCAN, tableData.length); row++) {
        const cell = (tableData[row]||[])[col];
        if (cell == null) continue;
        const norm = String(cell).toLowerCase().replace(/\s+/g,' ').trim();
        if (!norm) continue;
        let matched = false;
        for (const tpl of templates) {
          for (const syn of (synonyms[tpl]||[]).filter(Boolean)) {
            if (norm === syn.toLowerCase().replace(/\s+/g,' ').trim()) {
              selectedColumns.set(col, tpl); matched=true; break;
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
    }
  }

  /* ── Рендер таблицы ──────────────────────────────────────── */
  function _renderTable() {
    const tbl = $$('#ob-dataTable');
    if (!tbl) return;
    if (!tableData || !tableData.length) {
      tbl.innerHTML = '<tr><td>Нет данных</td></tr>';
      _updateStats(); return;
    }
    const maxCols = Math.max(0, ...tableData.map(r => r ? r.length : 0));
    const rowsToShow = Math.min(displayedRows, tableData.length);

    let html = '<thead><tr>';
    html += '<th class="xl-row-num">#</th>';
    for (let i = 0; i < maxCols; i++) {
      const sel = selectedColumns.has(i);
      html += `<th class="${sel?'col-selected':''}" data-col="${i}">`;
      if (sel) html += _createRenameInput(i, selectedColumns.get(i));
      else html += esc(String(i+1));
      html += '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let ri = 0; ri < rowsToShow; ri++) {
      const row = tableData[ri] || [];
      const hidden = ri < startRowIndex;
      html += `<tr class="${hidden?'row-hidden':''}" data-row-index="${ri}">`;
      html += `<td class="xl-row-num">${ri+1}</td>`;
      for (let i = 0; i < maxCols; i++) {
        const v = row[i] != null ? row[i] : '';
        const bg = selectedColumns.has(i) ? ' style="background:#ebf7ed;"' : '';
        html += `<td data-row="${ri}" data-col="${i}"${bg}>${esc(v)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
    tbl.innerHTML = html;
    _applyColWidths();
    _attachTableEvents();
    _updateStats();
  }

  function _createRenameInput(colIndex, value) {
    const val = String(value||'').replace(/"/g,'&quot;');
    const items = getTemplates().filter(Boolean).map(t =>
      `<div class="dropdown-item" data-value="${String(t).replace(/"/g,'&quot;')}">${esc(t)}</div>`
    ).join('');
    return `<div class="rename-wrapper" data-col="${colIndex}">
      <input class="rename-input" type="text" value="${val}" data-col="${colIndex}" placeholder="Название">
      <div class="dropdown" data-col="${colIndex}">${items}</div>
    </div>`;
  }

  function _applyColWidths() {
    if (!tableData || !tableData.length) return;
    const maxCols = Math.max(0, ...tableData.map(r => r ? r.length : 0));
    const MAX_W = 150, PAD = 18;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    const ctxH = document.createElement('canvas').getContext('2d');
    ctxH.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    const widths = new Array(maxCols).fill(0);
    for (let i = 0; i < maxCols; i++) widths[i] = Math.max(widths[i], ctxH.measureText(String(i+1)).width + PAD + 24);
    const sample = Math.min(tableData.length, 60);
    for (let ri = 0; ri < sample; ri++) {
      const row = tableData[ri] || [];
      for (let ci = 0; ci < maxCols; ci++) {
        const w = ctx.measureText(String(row[ci] != null ? row[ci] : '')).width + PAD;
        if (w > widths[ci]) widths[ci] = w;
      }
    }
    const tbl = $$('#ob-dataTable');
    if (!tbl) return;
    const table = tbl.closest ? tbl : tbl;
    let old = table.querySelector('colgroup');
    if (old) old.remove();
    const cg = document.createElement('colgroup');
    const cNum = document.createElement('col'); cNum.style.minWidth='36px'; cNum.style.width='36px';
    cg.appendChild(cNum);
    for (let i = 0; i < maxCols; i++) {
      const c = document.createElement('col');
      c.style.minWidth = Math.min(Math.ceil(widths[i]), MAX_W) + 'px';
      cg.appendChild(c);
    }
    table.insertBefore(cg, table.firstChild);
  }

  function _attachTableEvents() {
    if (!_el) return;
    _el.querySelectorAll('th[data-col]').forEach(th => {
      th.addEventListener('click', function(e) {
        if (e.target.closest('.rename-wrapper')) return;
        const ci = parseInt(th.dataset.col, 10);
        if (selectedColumns.has(ci)) { selectedColumns.delete(ci); _renderTable(); return; }
        selectedColumns.set(ci, ''); _renderTable();
        requestAnimationFrame(() => _openDropdown(ci, true));
      });
    });
    _el.querySelectorAll('.rename-input').forEach(inp => {
      inp.addEventListener('click', e => { e.stopPropagation(); _openDropdown(parseInt(inp.dataset.col,10), false); });
      inp.addEventListener('input', e => { selectedColumns.set(parseInt(inp.dataset.col,10), inp.value); _updateStats(); });
      inp.addEventListener('focus', e => e.target.select());
    });
    _el.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        const dd = e.target.closest('.dropdown');
        const ci = parseInt(dd.dataset.col, 10);
        const inp = _el.querySelector(`.rename-input[data-col="${ci}"]`);
        if (!inp) return;
        inp.value = e.target.dataset.value || '';
        selectedColumns.set(ci, inp.value);
        dd.classList.remove('show'); activeDropdown=null; _updateStats();
      });
    });
    // Row click — set startRowIndex
    _el.querySelectorAll('tbody tr[data-row-index]').forEach(tr => {
      tr.querySelector('.xl-row-num').addEventListener('click', () => {
        const ri = parseInt(tr.dataset.rowIndex, 10);
        startRowIndex = (startRowIndex === ri+1) ? 0 : ri+1;
        _renderTable();
      });
    });
  }

  function _openDropdown(colIndex, doFocus) {
    if (!_el) return;
    const input = _el.querySelector(`.rename-input[data-col="${colIndex}"]`);
    const dd    = _el.querySelector(`.dropdown[data-col="${colIndex}"]`);
    if (!input || !dd) return;
    if (activeDropdown && activeDropdown !== dd) activeDropdown.classList.remove('show');
    dd.classList.add('show'); activeDropdown = dd;
    if (doFocus) { input.focus(); input.select(); }
  }

  function _updateLoadMore() {
    const rem = (tableData ? tableData.length : 0) - displayedRows;
    const c = $$('#ob-loadMoreContainer');
    if (c) c.style.display = rem > 0 ? 'block' : 'none';
    const r = $$('#ob-remainingRows');
    if (r && rem > 0) r.textContent = String(rem);
  }

  function _updateStats() {
    if (!_el) return;
    const maxCols = tableData && tableData.length ? Math.max(0, ...tableData.map(r => r ? r.length : 0)) : 0;
    const tc = $$('#ob-totalColumns');    if (tc) tc.textContent = String(maxCols);
    const sc = $$('#ob-selectedColumns'); if (sc) sc.textContent = String(selectedColumns.size);
    const tr = $$('#ob-totalRows');       if (tr) tr.textContent = String(Math.max(0,(tableData?tableData.length:0)-startRowIndex));
    const db = $$('#ob-downloadBtn');     if (db) db.disabled = selectedColumns.size === 0;
  }

  /* ── Индикатор очереди ───────────────────────────────────── */
  function _renderQueueIndicator() {
    if (!_el) return;
    const { total, done } = App.queue.progress();
    const current = App.queue.current();

    const bar   = $$('#ob-queueBar');
    const prog  = $$('#ob-progressBar');
    const label = $$('#ob-progressLabel');
    const panel = $$('#ob-queuePanel');
    const status= $$('#ob-queueStatus');

    if (total === 0) {
      if (bar)   bar.classList.add('hidden');
      if (panel) panel.style.display='none';
      if (status)status.style.display='none';
      return;
    }

    const pct = total > 0 ? Math.round(done/total*100) : 0;
    if (bar)   bar.classList.remove('hidden');
    if (prog)  prog.style.width = pct + '%';
    if (label) label.textContent = `Файл ${done+1} из ${total}: ${current ? current.file.name : ''}`;

    if (status) { status.style.display='flex'; status.textContent = `В очереди: ${total-done-1}`; }

    if (panel) {
      panel.style.display = 'block';
      const curr = $$('#ob-queueCurrent');
      if (curr) curr.textContent = current ? '▶ ' + current.file.name : '';
      const list = $$('#ob-queueList');
      if (list) {
        list.innerHTML = '';
        AppState.queue.files.slice(done+1).forEach((item, i) => {
          const chip = document.createElement('span');
          chip.className = 'queue-chip';
          chip.textContent = (done+2+i) + '. ' + item.file.name;
          list.appendChild(chip);
        });
      }
    }
  }

  /* ── CSV генерация ───────────────────────────────────────── */
  function _buildCsvAndSkipped() {
    if (!selectedColumns.size) return { ok:false, error:'Выберите колонки.' };
    const indices = Array.from(selectedColumns.keys()).sort((a,b)=>a-b);
    const bcCol = findBarcodeCol(indices);
    if (bcCol === -1) return { ok:false, error:'Не найдена колонка штрихкода (название должно содержать «штрихкод» / barcode / ean).' };

    let nameCol = -1;
    if (complexModeEnabled) {
      for (const ci of indices) {
        const n = normHeader(selectedColumns.get(ci)||'');
        if (/наименован/.test(n) || /номенклатур/.test(n)) { nameCol=ci; break; }
      }
    }
    const prefixMap = complexModeEnabled ? _buildPrefixMap() : null;

    let csv = '\uFEFF' + indices.map(i => escCsv(selectedColumns.get(i)||'')).join(',') + '\n';
    const skipped = [];

    for (let ri = startRowIndex; ri < tableData.length; ri++) {
      const row = tableData[ri] || [];
      if (prefixMap !== null) {
        const { bcCol: bc2 } = _findSpecialCols();
        if (_isSubheaderRow(row, bc2)) continue;
      }
      const rawBC  = row[bcCol];
      const rawBCS = rawBC == null ? '' : String(rawBC);
      const normBC = normalizeBarcode(rawBC);
      if (!normBC || !/^\d+$/.test(normBC)) {
        skipped.push({ rowIndex:ri, rowNumber:ri+1, rawBarcode:rawBCS, normalizedBarcode:normBC||'',
          reason: !rawBCS.trim() ? 'Пустой штрихкод' : 'Некорректный штрихкод' });
        continue;
      }
      const vals = indices.map(ci => {
        if (ci === bcCol) return normBC;
        let v = row[ci] != null ? String(row[ci]).trim() : '';
        if (/^\d+,\d{2}$/.test(v)) v = v.replace(',','.');
        if (prefixMap && ci === nameCol && v) {
          const prefix = prefixMap.get(ri) || '';
          if (prefix && !_prefixContainedInName(v, prefix)) v = prefix + ' ' + v;
        }
        return v;
      });
      if (vals.every(v => !v)) continue;
      csv += vals.map(escCsv).join(',') + '\n';
    }
    return { ok:true, csvContent:csv, skipped };
  }

  /* ── Скачивание ──────────────────────────────────────────── */
  async function _onDownload() {
    const res = _buildCsvAndSkipped();
    if (!res.ok) { Utils.showError(res.error); return; }
    pendingCsvContent  = res.csvContent;
    pendingCsvFileName = originalFileName + '.csv';
    const preview = res.skipped.filter(s => s.reason !== 'Пустой штрихкод');
    if (preview.length) { _openSkippedModal(res.skipped); return; }
    await _doSaveAndAdvance();
  }

  async function _doSaveAndAdvance() {
    if (!pendingCsvContent) return;
    const fname = pendingCsvFileName || originalFileName + '.csv';
    const blob  = new Blob([pendingCsvContent], { type:'text/csv;charset=utf-8' });
    pendingCsvContent = null;
    _hideModal('ob-skippedModal');

    await App.queue.saveAndPass(blob, fname, _currentFileType);

    // App.queue.saveAndPass уже вызывает events.emit('queue:advanced')
    // Но для обновления UI модуля — делаем явно:
    selectedColumns.clear(); startRowIndex=0; displayedRows=50;

    if (App.queue.isDone()) {
      $$('#ob-tableContainer').style.display = 'none';
      _showCompleteScreen();
    } else {
      _loadFromAppQueue();
    }
  }

  /* ── Skipped modal ───────────────────────────────────────── */
  function _openSkippedModal(skipped) {
    pendingSkippedRows = skipped.slice();
    const preview = skipped.filter(s => s.reason !== 'Пустой штрихкод');
    const hidden  = skipped.length - preview.length;
    const toShow  = preview.slice(0, 500);
    const sumEl = $$('#ob-skippedSummary');
    if (sumEl) sumEl.textContent = `Всего пропусков: ${skipped.length}. Пустых скрыто: ${hidden}. Показано: ${toShow.length}.`;
    const tbl = $$('#ob-skippedTable');
    if (tbl) {
      let h = '<thead><tr><th style="min-width:60px">Строка</th><th style="min-width:180px">Штрихкод</th><th style="min-width:180px">Нормализован</th><th style="min-width:160px">Причина</th></tr></thead><tbody>';
      toShow.forEach(s => { h += `<tr><td>${esc(s.rowNumber)}</td><td>${esc(s.rawBarcode)}</td><td>${esc(s.normalizedBarcode)}</td><td>${esc(s.reason)}</td></tr>`; });
      h += '</tbody>';
      tbl.innerHTML = h;
    }
    _showModal('ob-skippedModal');
  }

  async function _confirmDownloadCsv() {
    await _doSaveAndAdvance();
  }

  function _showAllSkipped() {
    const tbl = $$('#ob-skippedTable');
    if (!tbl || !pendingSkippedRows.length) return;
    let h = '<thead><tr><th>Строка</th><th>Штрихкод</th><th>Нормализован</th><th>Причина</th></tr></thead><tbody>';
    pendingSkippedRows.forEach(s => { h += `<tr><td>${esc(s.rowNumber)}</td><td>${esc(s.rawBarcode)}</td><td>${esc(s.normalizedBarcode)}</td><td>${esc(s.reason)}</td></tr>`; });
    h += '</tbody>';
    tbl.innerHTML = h;
    const sumEl = $$('#ob-skippedSummary');
    if (sumEl) sumEl.textContent = `Все пропуски: ${pendingSkippedRows.length}`;
  }

  /* ── Экран завершения ────────────────────────────────────── */
  function _showCompleteScreen() {
    if (!_el) return;
    const screen = $$('#ob-completeScreen');
    if (!screen) return;

    const processed = AppState.queue.processed.length;
    const errors    = AppState.queue.errors.length;
    const suppliers = AppState.matcherFiles.suppliers.length;
    const hasOwn    = !!AppState.matcherFiles.own;

    const sumEl = $$('#ob-completeSummary');
    if (sumEl) sumEl.textContent = `Обработано файлов: ${processed}. Попадёт в матчер: ${suppliers} поставщик(ов)${hasOwn ? ' + мой прайс' : ''}.`;

    const errEl = $$('#ob-completeErrors');
    if (errEl) {
      if (errors > 0) {
        errEl.classList.remove('hidden');
        errEl.innerHTML = `<b>Ошибки (${errors}):</b><br>` +
          AppState.queue.errors.map(e => `• ${esc(e.name)}: ${esc(e.error)}`).join('<br>');
      } else {
        errEl.classList.add('hidden');
      }
    }

    screen.style.display = 'block';

    // Авто-навигация через 3 сек если есть файлы для матчера
    if (suppliers > 0 || hasOwn) {
      let countdown = 3;
      const autoEl = $$('#ob-autoNavigate');
      if (autoEl) {
        const tick = setInterval(() => {
          if (!_el) { clearInterval(tick); return; }
          countdown--;
          autoEl.textContent = `Переход в матчер через ${countdown}...`;
          if (countdown <= 0) { clearInterval(tick); App.navigate('matcher'); }
        }, 1000);
        autoEl.textContent = `Переход в матчер через ${countdown}...`;
      }
    }
  }

  /* ── Study mode ──────────────────────────────────────────── */
  function _toggleStudyMode() {
    studyMode = !studyMode;
    document.body.classList.toggle('study-mode', studyMode);
    const btn = $$('#ob-studyModeBtn');
    if (btn) {
      btn.classList.toggle('study-active', studyMode);
      const lbl = btn.querySelector('span:last-child');
      if (lbl) lbl.textContent = studyMode ? 'Выключить справку' : 'Справка';
    }
  }

  /* ── Templates modal ─────────────────────────────────────── */
  function _openTemplatesModal() {
    _renderTemplatesList();
    _showModal('ob-templatesModal');
    const inp = $$('#ob-newTemplateInput');
    if (inp) { inp.value=''; inp.focus(); }
  }

  function _addTemplate() {
    const inp = $$('#ob-newTemplateInput');
    const v = inp ? inp.value.trim() : '';
    if (!v) return;
    if (!AppState.config.columnTemplates.includes(v)) {
      AppState.config.columnTemplates.push(v);
    }
    if (inp) inp.value='';
    _renderTemplatesList();
    _renderTable();
  }

  function _renderTemplatesList() {
    const container = $$('#ob-templatesList');
    if (!container) return;
    const templates = getTemplates();
    const synonyms  = getSynonyms();
    container.innerHTML = '';
    templates.forEach((t, idx) => {
      const block = document.createElement('div');
      block.style.cssText = 'border:1px solid #e0e0e0;margin-bottom:6px;background:#fff;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:5px;align-items:center;padding:5px 8px;background:#f9f9f9;';

      const upBtn = document.createElement('button'); upBtn.className='btn btn-sm'; upBtn.textContent='↑'; upBtn.disabled=idx===0;
      upBtn.onclick = () => { if (!idx) return; [templates[idx-1],templates[idx]]=[templates[idx],templates[idx-1]]; _renderTemplatesList(); _renderTable(); };

      const dnBtn = document.createElement('button'); dnBtn.className='btn btn-sm'; dnBtn.textContent='↓'; dnBtn.disabled=idx===templates.length-1;
      dnBtn.onclick = () => { if (idx===templates.length-1) return; [templates[idx],templates[idx+1]]=[templates[idx+1],templates[idx]]; _renderTemplatesList(); _renderTable(); };

      const inp = document.createElement('input'); inp.type='text'; inp.value=t; inp.style.flex='1';
      const oldName = t;
      inp.onchange = () => {
        const n = inp.value.trim(); if (!n || n===oldName) return;
        if (synonyms[oldName]) { synonyms[n]=synonyms[oldName]; delete synonyms[oldName]; }
        templates[idx]=n; _renderTemplatesList(); _renderTable();
      };

      const synBtn = document.createElement('button'); synBtn.className='btn btn-sm'; synBtn.textContent='🔤 Синонимы';
      synBtn.onclick = () => {
        const p = block.querySelector('.syn-panel-inner');
        if (!p) return;
        const vis = p.style.display !== 'none';
        p.style.display = vis ? 'none' : 'block';
        synBtn.textContent = vis ? '🔤 Синонимы' : '🔤 Синонимы ▲';
      };

      const delBtn = document.createElement('button'); delBtn.className='btn btn-sm'; delBtn.style.color='#c00'; delBtn.textContent='Удалить';
      delBtn.onclick = () => { templates.splice(idx,1); _renderTemplatesList(); _renderTable(); };

      row.appendChild(upBtn); row.appendChild(dnBtn); row.appendChild(inp);
      row.appendChild(synBtn); row.appendChild(delBtn); block.appendChild(row);

      const synPanel = document.createElement('div'); synPanel.className='syn-panel-inner'; synPanel.style.display='none';
      synPanel.style.cssText='display:none;padding:8px 10px 10px;background:#f5f5f5;border-top:1px solid #e8e8e8;';
      _renderSynPanel(synPanel, t);
      block.appendChild(synPanel);
      container.appendChild(block);
    });
  }

  function _renderSynPanel(panel, tplName) {
    const synonyms = getSynonyms();
    panel.innerHTML = '';
    const syns = synonyms[tplName] || [];
    const lbl = document.createElement('div');
    lbl.style.cssText='font-size:11px;color:#737373;margin-bottom:5px;font-weight:700;text-transform:uppercase;';
    lbl.textContent='Синонимы для автораспознавания:';
    panel.appendChild(lbl);
    const chips = document.createElement('div');
    chips.style.cssText='display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;';
    syns.forEach((s, i) => {
      const chip = document.createElement('div');
      chip.style.cssText='display:inline-flex;align-items:center;background:#e8f4ef;border:1px solid #8fcfb0;border-radius:2px;padding:2px 2px 2px 7px;gap:1px;';
      const si = document.createElement('input'); si.type='text'; si.value=s;
      si.style.cssText='border:none;background:transparent;font-size:12px;padding:1px 3px;width:120px;outline:none;';
      si.onchange = () => { synonyms[tplName][i]=si.value.trim(); };
      const rm = document.createElement('button');
      rm.style.cssText='background:none;border:none;cursor:pointer;font-size:14px;color:#888;padding:0 4px;font-weight:700;';
      rm.textContent='×';
      rm.onclick = () => { synonyms[tplName].splice(i,1); _renderSynPanel(panel,tplName); };
      chip.appendChild(si); chip.appendChild(rm); chips.appendChild(chip);
    });
    panel.appendChild(chips);
    const addRow = document.createElement('div'); addRow.style.cssText='display:flex;gap:5px;';
    const addInp = document.createElement('input'); addInp.type='text'; addInp.placeholder='Новый синоним…';
    addInp.style.cssText='flex:1;padding:4px 8px;border:1px solid #d0d0d0;font-size:12px;background:#fff;border-radius:2px;';
    const addBtn = document.createElement('button'); addBtn.className='btn btn-sm btn-primary'; addBtn.textContent='+';
    addBtn.onclick = () => {
      const v=addInp.value.trim(); if (!v) return;
      if (!synonyms[tplName]) synonyms[tplName]=[];
      synonyms[tplName].push(v); addInp.value=''; _renderSynPanel(panel,tplName);
    };
    addInp.onkeydown = e => { if (e.key==='Enter') addBtn.click(); };
    addRow.appendChild(addInp); addRow.appendChild(addBtn); panel.appendChild(addRow);
  }

  /* ── Complex mode ────────────────────────────────────────── */
  function _detectComplexPricelist(ws) {
    const merges = ws['!merges'] || [];
    if (merges.length >= 3) return true;
    if (tableData) {
      let slashRows = 0;
      const sample = Math.min(tableData.length, 150);
      for (let ri=0; ri<sample; ri++) {
        const row = tableData[ri]||[];
        const rowText = row.map(c=>String(c||'').trim()).join(' ');
        if (/\\/.test(rowText)) { slashRows++; if (slashRows>=2) return true; }
      }
    }
    return false;
  }

  function _showComplexBanner(show) {
    const b = $$('#ob-complexBanner');
    if (b) b.classList.toggle('visible', show);
  }

  function _setComplexMode(enabled) {
    complexModeEnabled = enabled;
    const btn = $$('#ob-complexEnableBtn');
    const grp = $$('#ob-complexBtnGroup');
    const sep = $$('#ob-complexSep');
    if (enabled) {
      if (btn) { btn.textContent='✓ Режим активен — настроить'; btn.classList.add('active'); }
      if (grp) grp.style.display='flex';
      if (sep) sep.style.display='block';
      _renderComplexModal();
      _showModal('ob-complexModal');
    } else {
      if (btn) { btn.textContent='Включить режим подзаголовков'; btn.classList.remove('active'); }
      if (grp) grp.style.display='none';
      if (sep) sep.style.display='none';
      subheaderGroups=[];
    }
  }

  function _findSpecialCols() {
    let bcCol=-1, nameCol=-1;
    selectedColumns.forEach((label, ci) => {
      const n=normHeader(label||'');
      if (bcCol<0 && (/штрихкод/.test(n)||/barcode/.test(n)||/\bean\b/.test(n))) bcCol=ci;
      if (nameCol<0 && (/наименован/.test(n)||/номенклатур/.test(n))) nameCol=ci;
    });
    return { bcCol, nameCol };
  }

  function _findDataStartRow() {
    if (!tableData) return 0;
    for (let ri=0; ri<Math.min(tableData.length,20); ri++) {
      const row=tableData[ri]||[];
      const nonEmpty=row.filter(c=>c!=null&&String(c).trim()!=='');
      const rowText=nonEmpty.map(c=>String(c).trim()).join(' ');
      if (nonEmpty.length>=3&&!/\\/.test(rowText)) return ri+1;
    }
    return 0;
  }

  function _isSubheaderRow(row, bcCol) {
    if (bcCol>=0) { const bc=normalizeBarcode(row[bcCol]); if (bc&&/^\d{6,}$/.test(bc)) return false; }
    const nonEmpty=row.filter(c=>c!=null&&String(c).trim()!=='');
    if (nonEmpty.length===0) return false;
    if (nonEmpty.length<=2) {
      const text=String(nonEmpty[0]).trim();
      if (/^[\d\s.,]+$/.test(text)) return false;
      if (text.length<2) return false;
      return true;
    }
    return false;
  }

  function _parseTokens(rawText) {
    const titleCase=s=>s.length===0?s:s[0].toUpperCase()+s.slice(1).toLowerCase();
    const seen=new Set();
    return rawText.split(/[\\\/]+/)
      .map(t=>t.replace(/^[\s"«»'\u00ab\u00bb]+|[\s"«»'\u00ab\u00bb]+$/g,''))
      .filter(t=>t.length>1).map(t=>titleCase(t))
      .filter(t=>{ const k=t.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
  }

  function _getSampleProducts(subheaderRow, nameCol, count) {
    if (nameCol<0||!tableData) return [];
    const { bcCol }=_findSpecialCols();
    const samples=[];
    for (let ri=subheaderRow+1; ri<tableData.length&&samples.length<count; ri++) {
      const row=tableData[ri]||[];
      if (_isSubheaderRow(row,bcCol)) break;
      const name=String(row[nameCol]||'').trim();
      if (name) samples.push(name);
    }
    return samples;
  }

  function _autoSelectTokens(group) {
    if (!group.tokens.length) return;
    const candidates=group.tokens.slice(1);
    if (!candidates.length) { group.selectedTokens=[]; return; }
    if (!group.samples.length) { group.selectedTokens=[candidates[candidates.length-1]]; return; }
    const missing=candidates.filter(tok=>{ const t=tok.toLowerCase().replace(/\s+/g,' '); return !group.samples.some(name=>name.toLowerCase().includes(t)); });
    group.selectedTokens=missing.length>0?missing:[];
  }

  function _buildSubheaderGroups() {
    if (!tableData) return [];
    const { bcCol, nameCol }=_findSpecialCols();
    const dataStart=_findDataStartRow();
    const groups=new Map();
    for (let ri=Math.max(startRowIndex,dataStart); ri<tableData.length; ri++) {
      const row=tableData[ri]||[];
      if (!_isSubheaderRow(row,bcCol)) continue;
      const cells=row.filter(c=>c!=null&&String(c).trim()!=='');
      const rawText=cells.map(c=>String(c).trim()).join(' \\ ');
      const key=rawText.toLowerCase().replace(/\s+/g,' ').trim();
      if (!key) continue;
      if (!groups.has(key)) {
        const tokens=_parseTokens(rawText);
        const prev=subheaderGroups.find(g=>g.key===key)||{};
        const samples=_getSampleProducts(ri,nameCol,5);
        const newGroup={ key, rows:[], rawText, tokens, selectedTokens:(prev.selectedTokens||[]).slice(), skipped:prev.skipped||false, samples };
        if (!prev.selectedTokens) _autoSelectTokens(newGroup);
        groups.set(key,newGroup);
      }
      groups.get(key).rows.push(ri);
    }
    return Array.from(groups.values());
  }

  function _renderComplexModal() {
    subheaderGroups=_buildSubheaderGroups();
    const list=$$('#ob-complexSubheaderList');
    if (!list) return;
    list.innerHTML='';
    const noData=$$('#ob-complexNoData');
    const sumDiv=$$('#ob-complexSummaryDiv');
    if (subheaderGroups.length===0) {
      if (noData) noData.style.display='';
      if (sumDiv) sumDiv.style.display='none';
      return;
    }
    if (noData) noData.style.display='none';
    const updateSummary=()=>{
      const cfg=subheaderGroups.filter(g=>g.selectedTokens.length>0).length;
      const skipped=subheaderGroups.filter(g=>g.skipped).length;
      if (sumDiv) { sumDiv.style.display=''; sumDiv.textContent=`Найдено групп: ${subheaderGroups.length}. Настроено: ${cfg}.${skipped?` Скрыто: ${skipped}.`:''}`; }
    };
    updateSummary();

    // Quick bar
    const makeQBtn=(label,title,fn)=>{ const b=document.createElement('button'); b.className='btn btn-sm'; b.textContent=label; b.title=title; b.onclick=()=>{ fn(); _renderComplexModal(); }; return b; };
    const quickBar=document.createElement('div');
    quickBar.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap;';
    quickBar.appendChild(makeQBtn('🤖 Авто-выбор','Автоматически выбрать токены',()=>{ subheaderGroups.forEach(g=>{ g.skipped=false; _autoSelectTokens(g); }); }));
    quickBar.appendChild(makeQBtn('☑ Выбрать все первые','Выбрать первый токен каждой группы',()=>{ subheaderGroups.forEach(g=>{ g.skipped=false; if(g.tokens.length) g.selectedTokens=[g.tokens[0]]; }); }));
    quickBar.appendChild(makeQBtn('✕ Снять всё','Сбросить выбор',()=>{ subheaderGroups.forEach(g=>{ g.selectedTokens=[]; g.skipped=false; }); }));
    list.appendChild(quickBar);

    subheaderGroups.forEach(group=>{
      const card=document.createElement('div'); card.className='subheader-group'+(group.skipped?' is-skipped':'');
      const head=document.createElement('div'); head.className='subheader-group-head';
      const headTitle=document.createElement('span'); headTitle.className='subheader-group-head-title'; headTitle.textContent=group.rawText;
      head.appendChild(headTitle);
      const badge=document.createElement('span');
      badge.className='subheader-group-head-badge '+(group.selectedTokens.length>0?'badge-ok':'badge-skip');
      badge.textContent=group.skipped?'⊘ скрыта':group.selectedTokens.length>0?'+ '+group.selectedTokens.join(' '):'— без префикса';
      head.appendChild(badge);
      head.onclick=()=>{ if(group.skipped){ group.skipped=false; card.classList.remove('is-skipped'); badge.className='subheader-group-head-badge badge-skip'; badge.textContent='— без префикса'; updateSummary(); } };
      card.appendChild(head);

      const body=document.createElement('div'); body.className='subheader-group-body';
      if (group.samples.length>0) {
        const samplesDiv=document.createElement('div'); samplesDiv.className='sg-samples';
        group.samples.forEach(s=>{ const row=document.createElement('div'); row.className='sg-sample'; row.textContent=s; samplesDiv.appendChild(row); });
        body.appendChild(samplesDiv);
      }
      const instr=document.createElement('div'); instr.style.cssText='font-size:12px;color:#888;margin-bottom:6px;'; instr.textContent='Выберите токены для добавления в начало наименования:';
      body.appendChild(instr);
      const chipsRow=document.createElement('div'); chipsRow.className='token-chips';
      const previewList=document.createElement('div'); previewList.className='sg-preview-list';
      const refreshPreview=()=>{
        previewList.innerHTML='';
        const prefix=group.selectedTokens.join(' ');
        group.samples.forEach(name=>{
          const item=document.createElement('div'); item.className='sg-preview-item';
          if (!prefix) { item.className+=' preview-none'; item.textContent=name.slice(0,80); }
          else if (_prefixContainedInName(name,prefix)) { item.className+=' preview-skip'; item.textContent='⚠ уже есть: '+name.slice(0,75); }
          else { item.className+=' preview-added'; item.textContent='→ '+(prefix+' '+name).slice(0,80); }
          previewList.appendChild(item);
        });
        badge.className='subheader-group-head-badge '+(group.selectedTokens.length>0?'badge-ok':'badge-skip');
        badge.textContent=group.skipped?'⊘ скрыта':group.selectedTokens.length>0?'+ '+group.selectedTokens.join(' '):'— без префикса';
        updateSummary();
      };
      group.tokens.forEach(token=>{
        const chip=document.createElement('span'); chip.className='token-chip'+(group.selectedTokens.includes(token)?' selected':''); chip.textContent=token;
        chip.onclick=()=>{ const idx=group.selectedTokens.indexOf(token); if(idx>=0) group.selectedTokens.splice(idx,1); else group.selectedTokens.push(token); chip.classList.toggle('selected',group.selectedTokens.includes(token)); refreshPreview(); };
        chipsRow.appendChild(chip);
      });
      body.appendChild(chipsRow);
      const skipBtn=document.createElement('button'); skipBtn.className='sg-skip-btn'; skipBtn.textContent='⊘ скрыть группу';
      skipBtn.onclick=()=>{ group.skipped=true; group.selectedTokens=[]; card.classList.add('is-skipped'); badge.className='subheader-group-head-badge badge-skip'; badge.textContent='⊘ скрыта'; updateSummary(); };
      body.appendChild(skipBtn);
      const previewLabel=document.createElement('div'); previewLabel.style.cssText='font-size:11px;color:#888;margin-top:10px;margin-bottom:3px;'; previewLabel.textContent='Предпросмотр:';
      body.appendChild(previewLabel);
      body.appendChild(previewList);
      refreshPreview();
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  function _buildPrefixMap() {
    if (!complexModeEnabled||subheaderGroups.length===0) return null;
    const { bcCol }=_findSpecialCols();
    const groupByKey=new Map();
    subheaderGroups.forEach(g=>groupByKey.set(g.key,g));
    const dataStart=_findDataStartRow();
    const prefixMap=new Map();
    let currentPrefix='';
    for (let ri=Math.max(startRowIndex,dataStart); ri<tableData.length; ri++) {
      const row=tableData[ri]||[];
      if (_isSubheaderRow(row,bcCol)) {
        const cells=row.filter(c=>c!=null&&String(c).trim()!=='');
        const rawText=cells.map(c=>String(c).trim()).join(' \\ ');
        const key=rawText.toLowerCase().replace(/\s+/g,' ').trim();
        const group=groupByKey.get(key);
        currentPrefix=(group&&!group.skipped&&group.selectedTokens.length>0)?group.selectedTokens.join(' '):'';
        continue;
      }
      if (currentPrefix) prefixMap.set(ri,currentPrefix);
    }
    return prefixMap.size>0?prefixMap:null;
  }

  function _prefixContainedInName(name, prefix) {
    const nameLow=name.toLowerCase();
    return prefix.toLowerCase().split(/\s+/).every(tok=>tok.length>1&&nameLow.includes(tok));
  }

  /* ── Регистрация модуля ──────────────────────────────────── */
  App.registerModule('obrezatel', { init });

  return { init };

})();
