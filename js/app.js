/* ============================================================
   app.js — роутер, AppState, очередь файлов
   Экспортирует: window.App, window.AppState
   ============================================================ */

/* ── AppState — единый источник данных ─────────────────── */
window.AppState = {
  // Активный модуль
  activeModule: 'home',

  // Конфиг пользователя (из data/user-config.json)
  config: null,

  // База синонимов (из data/synonyms.json)
  synonyms: null,

  // Кэш обратного индекса штрихкодов (строится лениво)
  _barcodeIndex: null,

  // Флаг несохранённых изменений в синонимах
  _synonymsDirty: false,

  // Очередь файлов в Обрезателе
  queue: {
    files: [],      // [{ file: File, type: 'supplier'|'own' }]
    current: 0,     // индекс текущего файла
    processed: [],  // успешно обработанные
    errors: [],     // [{ name, error }]
  },

  // Файлы готовые для Матчера
  matcherFiles: {
    own: null,        // { name, buffer } или null
    suppliers: [],    // [{ name, buffer }]
  },

  // Зарезервировано для будущей авторизации
  user: null,
};

/* ── App — роутер и менеджер очереди ───────────────────── */
window.App = (function () {

  // Текущий активный модуль (для вызова destroy)
  let _currentModule = null;

  // Зарегистрированные модули
  const _modules = {};

  /* ── Регистрация модулей ─────────────────────────────── */
  function registerModule(name, mod) {
    _modules[name] = mod;
  }

  /* ── Навигация ───────────────────────────────────────── */
  function navigate(route) {
    // Предупреждение о несохранённых синонимах
    if (AppState._synonymsDirty) {
      const ok = confirm(
        'Есть несохранённые изменения в базе синонимов.\n' +
        'Перейти без сохранения?'
      );
      if (!ok) return;
    }

    const content = document.getElementById('app-content');
    if (!content) return;

    // Уничтожаем текущий модуль
    if (_currentModule && typeof _currentModule.destroy === 'function') {
      _currentModule.destroy();
    }
    _currentModule = null;

    // Обновляем nav
    document.querySelectorAll('.app-nav a[data-nav]').forEach(a => {
      a.classList.toggle('nav-active', a.dataset.nav === route);
    });

    // Класс на body для CSS-неймспейсинга
    document.body.className = route ? 'mod-' + route : '';

    // Обновляем AppState
    AppState.activeModule = route || 'home';

    // Обновляем URL
    history.pushState({ route: route || 'home' }, '', '#' + (route || 'home'));

    // Очищаем контент
    content.innerHTML = '';

    // Запускаем нужный модуль
    const mod = _modules[route || 'home'];
    if (mod && typeof mod.init === 'function') {
      _currentModule = mod.init(content) || null;
    } else {
      content.innerHTML = `
        <div class="error-screen">
          <h2>Страница не найдена</h2>
          <p>Модуль "${route}" не зарегистрирован.</p>
        </div>`;
    }

    // Обновляем индикатор очереди в nav
    _updateNavStatus();
  }

  /* ── Обновление статуса в навбаре ───────────────────── */
  function _updateNavStatus() {
    const el = document.getElementById('navQueueStatus');
    if (!el) return;

    const supplierCount = AppState.matcherFiles.suppliers.length;
    const hasOwn        = !!AppState.matcherFiles.own;

    if (supplierCount > 0 || hasOwn) {
      const parts = [];
      if (supplierCount > 0) parts.push(`${supplierCount} прайс${_plural(supplierCount, '', 'а', 'ов')}`);
      if (hasOwn)            parts.push('мой прайс');
      el.innerHTML = `
        <span>В матчере:</span>
        <span class="nav-badge">${parts.join(' + ')}</span>`;
    } else {
      el.innerHTML = '';
    }
  }

  function _plural(n, one, few, many) {
    const mod10  = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  /* ── Менеджер очереди ────────────────────────────────── */
  const queue = {
    // Добавить файлы в очередь
    add(files, type) {
      const items = Array.from(files).map(file => ({ file, type }));
      AppState.queue.files.push(...items);
      _updateNavStatus();
    },

    // Текущий элемент очереди
    current() {
      return AppState.queue.files[AppState.queue.current] || null;
    },

    // Прогресс
    progress() {
      const total = AppState.queue.files.length;
      const done  = AppState.queue.current;
      return { total, done, remaining: total - done };
    },

    // Сохранить файл + передать в матчер + перейти к следующему
    async saveAndPass(blob, filename, type) {
      // 1. Скачать на устройство
      Utils.downloadBlob(blob, filename);

      // 2. Передать в матчер
      const buffer = await blob.arrayBuffer();
      if (type === 'own') {
        AppState.matcherFiles.own = { name: filename, buffer };
      } else {
        AppState.matcherFiles.suppliers.push({ name: filename, buffer });
      }

      // 3. Отметить как обработанный
      const item = queue.current();
      if (item) {
        AppState.queue.processed.push({
          name: filename, type, file: item.file
        });
      }

      // 4. Продвинуть очередь
      AppState.queue.current++;
      _updateNavStatus();

      // 5. Сообщить модулю
      events.emit('queue:advanced');
    },

    // Обработать ошибку текущего файла и продвинуть
    skipWithError(filename, errorMsg) {
      AppState.queue.errors.push({ name: filename, error: errorMsg });
      AppState.queue.current++;
      events.emit('queue:advanced');
    },

    // Сбросить очередь
    reset() {
      AppState.queue = { files: [], current: 0, processed: [], errors: [] };
      _updateNavStatus();
    },

    // Все файлы обработаны?
    isDone() {
      return AppState.queue.files.length > 0 &&
             AppState.queue.current >= AppState.queue.files.length;
    },
  };

  /* ── Простая шина событий ────────────────────────────── */
  const _listeners = {};
  const events = {
    on(event, fn) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },
    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },
    emit(event, data) {
      (_listeners[event] || []).forEach(fn => fn(data));
    },
  };

  /* ── Загрузка данных при старте ─────────────────────── */
  async function _loadData() {
    const [configRes, synonymsRes] = await Promise.all([
      fetch('data/user-config.json'),
      fetch('data/synonyms.json'),
    ]);

    if (!configRes.ok)   throw new Error('Не удалось загрузить data/user-config.json');
    if (!synonymsRes.ok) throw new Error('Не удалось загрузить data/synonyms.json');

    AppState.config   = await configRes.json();
    AppState.synonyms = await synonymsRes.json();

    // Валидация минимальная
    if (!AppState.config.columnTemplates)  throw new Error('user-config.json: нет columnTemplates');
    if (!AppState.synonyms.barcodes)       throw new Error('synonyms.json: нет barcodes');

    console.log('[App] Конфиг загружен, шаблонов:', AppState.config.columnTemplates.length);
    console.log('[App] Синонимы загружены, групп:', Object.keys(AppState.synonyms.barcodes).length);
  }

  /* ── Инициализация приложения ────────────────────────── */
  async function init() {
    // Инициализируем tooltip
    Utils.initTooltip();

    // Клик по nav
    const nav = document.getElementById('appNav');
    if (nav) {
      nav.addEventListener('click', e => {
        const a = e.target.closest('[data-nav]');
        if (!a) return;
        e.preventDefault();
        navigate(a.dataset.nav);
      });
    }

    // Кнопка назад/вперёд
    window.addEventListener('popstate', e => {
      navigate(e.state && e.state.route ? e.state.route : 'home');
    });

    // Загружаем данные
    try {
      await _loadData();
    } catch (err) {
      document.getElementById('app-content').innerHTML = `
        <div class="error-screen">
          <h2>Ошибка загрузки данных</h2>
          <p>${Utils.escapeHtml(err.message)}</p>
          <p class="text-muted">
            Убедитесь что файлы <code>data/user-config.json</code>
            и <code>data/synonyms.json</code> доступны,<br>
            и откройте приложение через веб-сервер (не file://).
          </p>
        </div>`;
      return;
    }

    // Определяем начальный роут из URL
    const initialRoute = (location.hash || '').replace('#', '') || 'home';
    navigate(initialRoute);
  }

  /* ── Запуск после загрузки DOM ───────────────────────── */
  document.addEventListener('DOMContentLoaded', init);

  /* ── Публичный API ───────────────────────────────────── */
  return {
    navigate,
    registerModule,
    queue,
    events,
    updateNavStatus: _updateNavStatus,
  };

})();
