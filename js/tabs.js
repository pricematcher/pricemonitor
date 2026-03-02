// ============================================================
// TABS, TUTORIAL, SEARCH, FILTER BUTTONS
// ============================================================
import * as S from './state.js';
import { renderTable } from './tableRenderer.js';
import { showToast } from './utils.js';

// ---- Main tabs ----
export function initTabs() {
  document.querySelectorAll('.main-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.mainTab;
      document.querySelectorAll('.main-pane').forEach(p => p.style.display = 'none');
      document.getElementById(`pane-${tabId}`).style.display = '';
    });
  });
}

// ---- Synonym subtabs ----
export function initSubtabs() {
  document.querySelectorAll('.syn-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.syn-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sub = btn.dataset.subtab;
      document.getElementById('subpane-barcodes').style.display = sub === 'barcodes' ? '' : 'none';
      document.getElementById('subpane-brands').style.display   = sub === 'brands'   ? '' : 'none';
    });
  });
}

// ---- Tutorial mode ----
export function initTutorial() {
  const tooltip = document.getElementById('tutorialTooltip');

  document.getElementById('tutorialBtn').addEventListener('click', () => {
    document.getElementById('tutorialBtn').classList.toggle('active');
    document.body.classList.toggle('tutorial-active');
  });

  document.addEventListener('mouseover', e => {
    if (!document.body.classList.contains('tutorial-active')) return;
    let el = e.target;
    while (el && !el.title && el !== document.body) el = el.parentElement;
    if (el && el.title) {
      tooltip.textContent  = el.title;
      tooltip.style.opacity = '1';
    } else {
      tooltip.style.opacity = '0';
    }
  });

  document.addEventListener('mousemove', e => {
    if (!document.body.classList.contains('tutorial-active')) return;
    tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
    tooltip.style.top  = Math.min(e.clientY + 14, window.innerHeight - 100) + 'px';
  });

  document.addEventListener('mouseout', () => { tooltip.style.opacity = '0'; });
}

// ---- Search ----
export function initSearch() {
  let _searchDebounce;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => {
      S.setSearchQuery(e.target.value);
      renderTable();
    }, 180);
  });
}

// ---- Filter / sort buttons ----
export function initFilterButtons() {
  function toggleSortBtn(id, mode) {
    const btn = document.getElementById(id);
    if (S.sortMode === mode) {
      S.setSortMode('default');
      btn.classList.remove('active');
    } else {
      S.setSortMode(mode);
      ['sortMatchesBtn','bigDiffBtn','showMyPriceBtn'].forEach(b => document.getElementById(b)?.classList.remove('active'));
      S.setFilterNewItems(false);
      document.getElementById('maxCoverageBtn')?.classList.remove('active');
      btn.classList.add('active');
    }
    renderTable();
  }

  document.getElementById('sortMatchesBtn').onclick = () => toggleSortBtn('sortMatchesBtn', 'matches');
  document.getElementById('bigDiffBtn').onclick      = () => toggleSortBtn('bigDiffBtn',      'bigdiff');
  document.getElementById('showMyPriceBtn').onclick  = () => toggleSortBtn('showMyPriceBtn',  'myprice');

  document.getElementById('maxCoverageBtn').onclick = () => {
    if (!S.myPriceData) { showToast('Сначала загрузите «Мой прайс»', 'warn'); return; }
    S.setFilterNewItems(!S.filterNewItems);
    S.setSortMode('default');
    ['sortMatchesBtn','bigDiffBtn','showMyPriceBtn'].forEach(b => document.getElementById(b)?.classList.remove('active'));
    document.getElementById('maxCoverageBtn').classList.toggle('active', S.filterNewItems);
    renderTable();
  };

  document.getElementById('compactMatchesBtn').onclick = () => {
    S.setCompactMatches(!S.compactMatches);
    document.getElementById('compactMatchesBtn').classList.toggle('active', S.compactMatches);
    renderTable();
  };
}
