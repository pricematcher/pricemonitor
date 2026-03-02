// ============================================================
// MATCHER WEB WORKER
// Runs in a separate thread. No DOM access.
// ============================================================

const TL = {
  a:'а',b:'б',c:'с',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'й',k:'к',
  l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',
  w:'в',x:'кс',y:'й',z:'з'
};
const STOP = new Set([
  'г','кг','мл','л','шт','уп','пак','бл','бут','арт',
  'с','в','из','для','на','по','от','а','и','или','не','но',
  'это','он','она','оно','мл','литр','литра','литров','грамм','граммов','штук'
]);

function translitWord(w) {
  return w.split('').map(c => TL[c] || c).join('');
}

function normalizeUnits(s) {
  return s
    .replace(/([0-9])\s*(л)(?![а-яё])/gi, '$1 л')
    .replace(/([0-9])\s*(кг)/gi,           '$1 кг')
    .replace(/([0-9])\s*(мл)/gi,           '$1 мл')
    .replace(/([0-9])\s*(г)(?![а-яё])/gi,  '$1 г');
}

function preNorm(raw) {
  return normalizeUnits(String(raw).toLowerCase()).replace(/([а-яёa-z])-([а-яёa-z])/g, '$1 $2');
}

function normalize(raw) {
  let s = preNorm(raw);
  s = s.replace(/[^а-яёa-z0-9\s]/g, ' ');
  const tokens = s.split(/\s+/).filter(Boolean);
  const result = [];
  for (let t of tokens) {
    if (/^[a-z]+$/.test(t)) t = translitWord(t);
    if (STOP.has(t)) continue;
    if (t.length > 2) result.push(t);
    else if (/^\d+$/.test(t)) result.push(t);
  }
  return result;
}

function trigramSet(tokens) {
  const s   = tokens.join(' ');
  const set = new Set();
  for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i+3));
  return set;
}

function triSim(a, b) {
  const sa = trigramSet(a), sb = trigramSet(b);
  if (!sa.size && !sb.size) return 1;
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

function lcsSim(a, b) {
  if (!a.length || !b.length) return 0;
  const dp = Array(a.length+1).fill(null).map(() => Array(b.length+1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  return 2 * dp[a.length][b.length] / (a.length + b.length);
}

function applyBrandNorm(tokens, bsynMap) {
  const out = []; let bonus = 0;
  for (const t of tokens) {
    const mapped = bsynMap.get(t);
    if (mapped && mapped !== t) { out.push(mapped); bonus = 0.20; }
    else out.push(t);
  }
  return { tokens: out, bonus };
}

function calcSim(n1, n2, bsynMap, bantMap) {
  const t1raw = normalize(n1);
  const t2raw = normalize(n2);
  const { tokens: t1, bonus: b1 } = applyBrandNorm(t1raw, bsynMap);
  const { tokens: t2, bonus: b2 } = applyBrandNorm(t2raw, bsynMap);
  const synBonus = (b1 || b2) ? 0.20 : 0;

  // Antonym check
  for (const t of t1) {
    if (bantMap.has(t)) { const anti = bantMap.get(t); if (t2.some(x => x === anti)) return 0; }
  }
  for (const t of t2) {
    if (bantMap.has(t)) { const anti = bantMap.get(t); if (t1.some(x => x === anti)) return 0; }
  }

  if (!t1.length || !t2.length) return 0;

  // Number factor
  const nums1 = t1.filter(t => /^\d+$/.test(t));
  const nums2 = t2.filter(t => /^\d+$/.test(t));
  let numFactor = 1.0;
  if (nums1.length > 0 && nums2.length > 0) {
    const common = nums1.filter(n => nums2.includes(n));
    if (common.length === 0) numFactor = 0.82;
    else if (common.length < Math.max(nums1.length, nums2.length)) numFactor = 0.90;
  }

  // Length penalty
  const minLen = Math.min(t1.length, t2.length);
  const maxLen = Math.max(t1.length, t2.length);
  let lenPenalty = 1.0;
  if (maxLen > 0) {
    const r = minLen / maxLen;
    if (r < 0.33) lenPenalty = 0.6;
    else if (r < 0.5) lenPenalty = 0.82;
  }

  const tri = triSim(t1, t2);
  const lcs = lcsSim(t1, t2);

  const set1 = new Set(t1), set2 = new Set(t2);
  let common = 0;
  for (const t of set1) if (set2.has(t)) common++;
  const wTok = common / Math.max(set1.size, set2.size, 1);

  const avgLen = (t1.length + t2.length) / 2;
  const wTri  = avgLen <= 3 ? 0.3 : 0.4;
  const wLcs  = 0.3;
  const wTokW = avgLen <= 3 ? 0.4 : 0.3;

  let score = (tri * wTri + lcs * wLcs + wTok * wTokW) * numFactor * lenPenalty + synBonus;
  score = Math.min(1, score);
  return Math.round(score * 100);
}

// ---- Worker message handler ----
self.onmessage = function(e) {
  const { files, bsynArr, bantArr } = e.data;
  const bsynMap = new Map(bsynArr);
  const bantMap = new Map(bantArr);

  const items = [];
  for (const f of files) {
    for (const row of f.items) {
      items.push({ ...row, fileName: f.fileName });
    }
  }

  const pairs = [];
  const total = items.length;
  let done = 0;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.fileName === b.fileName) continue;
      if (a.barcode && b.barcode && a.barcode === b.barcode) continue;
      const sim = calcSim(a.name, b.name, bsynMap, bantMap);
      if (sim >= 52) pairs.push({ a, b, sim });
    }
    done++;
    if (done % 50 === 0) self.postMessage({ type: 'progress', done, total });
  }

  self.postMessage({ type: 'done', pairs });
};
