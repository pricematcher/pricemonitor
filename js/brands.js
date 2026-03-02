// ============================================================
// BRAND DB MANAGEMENT
// ============================================================
import * as S from './state.js';
import { showToast, jeConfirmDialog } from './utils.js';
import { unifiedMarkUnsaved } from './synonymEditor.js';

export function brandNormKey(s) { return s.trim().toLowerCase(); }

// ---- Render brand cards ----
export function brandRender() {
  const q     = document.getElementById('brandSearchInp')?.value.toLowerCase() || '';
  const list  = document.getElementById('brandCardsList');
  const badge = document.getElementById('brandCountBadge');
  if (badge) badge.textContent = Object.keys(S._brandDB).length;

  const keys = Object.keys(S._brandDB).filter(k => {
    if (!q) return true;
    return k.includes(q) ||
      (S._brandDB[k].synonyms || []).some(s => s.includes(q)) ||
      (S._brandDB[k].antonyms || []).some(s => s.includes(q));
  });

  list.innerHTML = keys.length === 0
    ? `<div style="color:#888;font-size:13px;padding:16px;">База брендов пуста${q ? ' (нет результатов)' : ''}</div>`
    : keys.map(k => {
        const b    = S._brandDB[k];
        const syns = (b.synonyms || []).join(', ');
        const anti = (b.antonyms || []).join(', ');
        return `<div class="brand-card">
          <div class="brand-card-title">🏷️ ${k}</div>
          <div class="brand-card-syns">Синонимы: <span>${syns || '—'}</span></div>
          <div class="brand-card-anti">Антонимы: <span>${anti || '—'}</span></div>
          <div class="brand-card-actions">
            <button data-brand-edit="${encodeURIComponent(k)}">✏️ Изменить</button>
            <button class="del-btn" data-brand-del="${encodeURIComponent(k)}">🗑 Удалить</button>
          </div>
        </div>`;
      }).join('');
}

// ---- Open edit modal ----
export function brandOpenEdit(encKey) {
  const key = decodeURIComponent(encKey);
  const b   = S._brandDB[key];
  if (!b) return;
  document.getElementById('beEditKey').value = key;
  document.getElementById('beCanon').value   = key;
  document.getElementById('beSyns').value    = (b.synonyms || []).join('\n');
  document.getElementById('beAnti').value    = (b.antonyms || []).join('\n');
  document.getElementById('brandEditModal').classList.add('open');
}

export function closeBrandEditModal() {
  document.getElementById('brandEditModal').classList.remove('open');
}

export function brandSaveEdit() {
  const oldKey = document.getElementById('beEditKey').value;
  const newKey = brandNormKey(document.getElementById('beCanon').value);
  if (!newKey) { showToast('Введите название бренда', 'warn'); return; }
  const syns = document.getElementById('beSyns').value.split(/[\n,]/).map(s => brandNormKey(s)).filter(Boolean);
  const anti = document.getElementById('beAnti').value.split(/[\n,]/).map(s => brandNormKey(s)).filter(Boolean);
  const conflict = anti.find(a => syns.includes(a));
  if (conflict) { showToast(`Конфликт: "${conflict}" одновременно синоним и антоним`, 'err'); return; }
  if (oldKey && oldKey !== newKey) delete S._brandDB[oldKey];
  S._brandDB[newKey] = { synonyms: syns, antonyms: anti };
  brandRender();
  unifiedMarkUnsaved(true);
  closeBrandEditModal();
  showToast('Бренд сохранён', 'ok');
}

// ---- Add modal ----
export function brandOpenAddModal() {
  document.getElementById('baCanon').value = '';
  document.getElementById('baSyns').value  = '';
  document.getElementById('baAnti').value  = '';
  document.getElementById('brandAddModal').classList.add('open');
}

export function closeBrandAddModal() {
  document.getElementById('brandAddModal').classList.remove('open');
}

// ---- Delete ----
export function brandDelete(encKey) {
  const key = decodeURIComponent(encKey);
  jeConfirmDialog(`Удалить бренд «${key}»?`).then(ok => {
    if (!ok) return;
    delete S._brandDB[key];
    brandRender();
    unifiedMarkUnsaved(true);
    showToast('Бренд удалён', 'ok');
  });
}

// ---- AI Prompt ----
export function buildAiPrompt(extra) {
  return `Ты — эксперт по брендам FMCG-товаров. Тебе нужно создать JSON-словарь синонимов брендов для системы матчинга прайс-листов.

Для каждого бренда создай объект с полями:
- "canonical": нормализованное название бренда в нижнем регистре (ключ)
- "synonyms": массив вариантов написания (транслит, кириллица, сокращения, опечатки)
- "antonyms": массив конкурирующих брендов, которые НИКОГДА не должны совпасть

Верни ТОЛЬКО JSON-массив без пояснений:
[{"canonical":"...", "synonyms":[...], "antonyms":[...]}]

${extra ? 'Бренды для обработки:\n' + extra : ''}`;
}

export function aiRefreshPrompt() {
  const extra = document.getElementById('aiBrandsList')?.value.trim() || '';
  const box   = document.getElementById('aiPromptBox');
  if (box) box.value = buildAiPrompt(extra);
}

// ---- Init brand event listeners ----
export function initBrands() {
  document.getElementById('brandSearchInp').addEventListener('input', brandRender);

  // Delegated clicks on brand cards
  document.getElementById('brandCardsList').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-brand-edit]');
    if (editBtn) { brandOpenEdit(editBtn.dataset.brandEdit); return; }
    const delBtn = e.target.closest('[data-brand-del]');
    if (delBtn) { brandDelete(delBtn.dataset.brandDel); return; }
  });

  document.getElementById('brandOpenAddModalBtn').addEventListener('click', brandOpenAddModal);

  document.getElementById('brandAddBtn').addEventListener('click', () => {
    const key = brandNormKey(document.getElementById('baCanon').value);
    if (!key) { showToast('Введите название бренда', 'warn'); return; }
    if (S._brandDB[key]) { showToast('Бренд уже существует', 'warn'); return; }
    const syns = document.getElementById('baSyns').value.split(/[\n,]/).map(s => brandNormKey(s)).filter(Boolean);
    const anti = document.getElementById('baAnti').value.split(/[\n,]/).map(s => brandNormKey(s)).filter(Boolean);
    const conflict = anti.find(a => syns.includes(a));
    if (conflict) { showToast(`Конфликт: "${conflict}" одновременно синоним и антоним`, 'err'); return; }
    S._brandDB[key] = { synonyms: syns, antonyms: anti };
    brandRender();
    unifiedMarkUnsaved(true);
    closeBrandAddModal();
    showToast('Бренд добавлен', 'ok');
  });

  document.getElementById('brandClearAllBtn').addEventListener('click', async () => {
    const ok = await jeConfirmDialog('Очистить всю базу брендов?');
    if (!ok) return;
    S.setBrandDB({});
    brandRender();
    unifiedMarkUnsaved(true);
    showToast('База брендов очищена', 'warn');
  });

  document.getElementById('aiCopyPromptBtn').addEventListener('click', () => {
    const text = document.getElementById('aiPromptBox').value;
    navigator.clipboard.writeText(text).then(() => showToast('Промпт скопирован', 'info'));
  });
  document.getElementById('aiRefreshPromptBtn').addEventListener('click', aiRefreshPrompt);
  document.getElementById('aiBrandsList').addEventListener('input', aiRefreshPrompt);

  document.getElementById('aiImportBtn').addEventListener('click', () => {
    try {
      const raw = document.getElementById('aiJsonInput').value.trim();
      const arr = JSON.parse(raw);
      let added = 0;
      for (const item of arr) {
        const key = brandNormKey(item.canonical || '');
        if (!key) continue;
        S._brandDB[key] = {
          synonyms: (item.synonyms || []).map(brandNormKey).filter(Boolean),
          antonyms: (item.antonyms || []).map(brandNormKey).filter(Boolean)
        };
        added++;
      }
      brandRender();
      unifiedMarkUnsaved(true);
      showToast(`Импортировано ${added} брендов`, 'ok');
    } catch(e) { showToast('Ошибка парсинга JSON: ' + e.message, 'err'); }
  });
}
