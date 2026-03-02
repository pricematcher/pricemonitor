// ============================================================
// APP ENTRY POINT
// Imports all modules and initialises the application.
// ============================================================
import { initTabs, initSubtabs, initTutorial, initSearch, initFilterButtons } from './tabs.js';
import { initUpload } from './upload.js';
import { initTableDelegation } from './tableRenderer.js';
import { initSynonymEditor, jeRenderEditor } from './synonymEditor.js';
import { initBrands, brandRender, aiRefreshPrompt } from './brands.js';
import { initMatcher } from './matcher.js';
import { initExporter } from './exporter.js';
import { initClearAll, exposeGlobals, openAddToDB, editCustomCell, removeCustomColumn } from './modals.js';
import { showToast } from './utils.js';
import { renderTable } from './tableRenderer.js';

// ---- Bootstrap ----
document.addEventListener('DOMContentLoaded', () => {

  // Navigation / layout
  initTabs();
  initSubtabs();
  initTutorial();
  initSearch();
  initFilterButtons();

  // File uploads
  initUpload();

  // Table delegation (passes callbacks needed inside table cells)
  initTableDelegation({
    showToast,
    openAddToDB,
    editCustomCell,
    removeCustomColumn
  });

  // Synonym barcode editor
  initSynonymEditor({ renderTable });

  // Brand management
  initBrands();
  aiRefreshPrompt();
  brandRender();

  // Matcher
  initMatcher({ renderTable });

  // Excel export
  initExporter();

  // Clear all button
  initClearAll();

  // Expose functions needed by inline onclick HTML attributes in modals
  // (modals use onclick="closeBcAddModal()" etc.)
  exposeGlobals();

  // Initial render of empty synonym editor
  jeRenderEditor();
});
