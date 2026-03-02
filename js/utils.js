// ============================================================
// UTILITY FUNCTIONS
// ============================================================

// ---- Toast ----
export function showToast(msg, type = 'ok') {
  const area = document.getElementById('jeToastArea');
  const t = document.createElement('div');
  t.className = 'je-toast';
  const colors = {
    ok:   { bg: '#1a4731', border: '#2d9a5f' },
    err:  { bg: '#721c24', border: '#d93025' },
    warn: { bg: '#7d5a00', border: '#ffc107' },
    info: { bg: '#1a3c80', border: '#4a7adc' }
  };
  const c = colors[type] || colors.ok;
  t.style.cssText = `background:${c.bg};border-left-color:${c.border};`;
  t.textContent = msg;
  area.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}

// ---- Confirm Dialog ----
export function jeConfirmDialog(msg, title = 'Подтверждение') {
  return new Promise(resolve => {
    document.getElementById('jeConfirmTitle').textContent = title;
    document.getElementById('jeConfirmMsg').textContent   = msg;
    document.getElementById('jeConfirmModal').classList.add('open');

    const yes = document.getElementById('jeConfirmYes');
    const no  = document.getElementById('jeConfirmNo');

    const cleanup = (val) => {
      document.getElementById('jeConfirmModal').classList.remove('open');
      yes.replaceWith(yes.cloneNode(true));
      no.replaceWith(no.cloneNode(true));
      resolve(val);
    };

    document.getElementById('jeConfirmYes').onclick = () => cleanup(true);
    document.getElementById('jeConfirmNo').onclick  = () => cleanup(false);
  });
}

// ---- Copy to clipboard ----
export function copyToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

// ---- Date string YYYY-MM-DD ----
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- Download blob ----
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
