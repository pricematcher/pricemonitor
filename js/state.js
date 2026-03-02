// ============================================================
// GLOBAL APPLICATION STATE
// All mutable state lives here. Import and mutate directly.
// ============================================================

// ----- File data -----
export let myPriceData       = null;
export let competitorFilesData = [];
export let allFilesData      = [];

// ----- Processed data -----
export let groupedData  = [];
export let allColumns   = [];
export let visibleColumns = new Set();

// ----- Column detection -----
export let barcodeColumn  = null;
export let nameColumn     = null;
export let stockColumn    = null;
export let transitColumn  = null;
export let showTransitColumn = false;

// ----- Custom columns -----
export let customColumns = [];
export let customColData = {};

// ----- UI state -----
export let sortMode     = 'default';
export let searchQuery  = '';
export let compactMatches  = false;
export let filterNewItems  = false;

// ----- Synonym / barcode DB -----
export let barcodeAliasMap = new Map();
export let synonymsLoaded  = false;
export let jeDB  = {};
export let jeUndoStack = [];
export let jeRedoStack = [];

// ----- Brand DB -----
export let _brandDB = {};

// ----- Matcher -----
export let _matcherDisabledFiles = new Set();
export let _matchPairs = [];
export let _matchView  = 'all';
export let _matchHideKnown = false;

// ----- Virtual scroll -----
export const MVS    = { ROW_H: 42, OVERSCAN: 30, start: 0, end: 0, ticking: false };
export const JE_VS  = { ROW_H: 40, OVERSCAN: 20, start: 0, end: 0, ticking: false };
export const JE_VS_THRESHOLD = 100;

// ----- Virtual scroll data cache -----
export let _vsData = [];

// ============================================================
// SETTERS — use these when you need to replace a value
// (for primitives / objects where reassignment is needed)
// ============================================================
export function setMyPriceData(v)          { myPriceData = v; }
export function setCompetitorFilesData(v)  { competitorFilesData = v; }
export function setAllFilesData(v)         { allFilesData = v; }
export function setGroupedData(v)          { groupedData = v; }
export function setAllColumns(v)           { allColumns = v; }
export function setStockColumn(v)          { stockColumn = v; }
export function setTransitColumn(v)        { transitColumn = v; }
export function setBarcodeColumn(v)        { barcodeColumn = v; }
export function setNameColumn(v)           { nameColumn = v; }
export function setSynonymsLoaded(v)       { synonymsLoaded = v; }
export function setJeDB(v)                 { jeDB = v; }
export function setBrandDB(v)              { _brandDB = v; }
export function setJeUndoStack(v)          { jeUndoStack = v; }
export function setJeRedoStack(v)          { jeRedoStack = v; }
export function setSortMode(v)             { sortMode = v; }
export function setSearchQuery(v)          { searchQuery = v; }
export function setCompactMatches(v)       { compactMatches = v; }
export function setFilterNewItems(v)       { filterNewItems = v; }
export function setMatchPairs(v)           { _matchPairs = v; }
export function setMatchView(v)            { _matchView = v; }
export function setMatchHideKnown(v)       { _matchHideKnown = v; }
export function setVsData(v)               { _vsData = v; }
export function setCustomColumns(v)        { customColumns = v; }
export function setCustomColData(v)        { customColData = v; }
export function setShowTransitColumn(v)    { showTransitColumn = v; }
