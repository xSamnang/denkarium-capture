// --- Tastenkürzel: Aufnahme & Projektwechsel per Tastatur oder Maus ---
// Alle Kürzel sind optional (Standard: nichts belegt) - ohne bewusste
// Konfiguration ändert sich am bisherigen Verhalten also nichts. Belegung
// wird lokal gespeichert. Die eigentlichen Aktionen liegen bewusst in
// app.js (toggleRecordingFromHotkey) bzw. projects.js (stepProject); diese
// Datei kümmert sich nur um Erfassung, Speicherung und die globalen Listener.

const HOTKEYS_KEY = 'denkarium_hotkeys';

// Reihenfolge = Auswertungsreihenfolge; 'record' zuerst.
const HOTKEY_ACTIONS = ['record', 'projectNext', 'projectPrev'];

function loadHotkeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HOTKEYS_KEY));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) { /* beschädigt - leer starten */ }
  return {};
}

let hotkeys = loadHotkeys();
let capturingAction = null; // welche Aktion gerade auf eine Eingabe wartet

function saveHotkeys() {
  localStorage.setItem(HOTKEYS_KEY, JSON.stringify(hotkeys));
}

/* ---------- Anzeige-Namen ---------- */

const KEY_LABEL = {
  Space: 'Leertaste',
  Enter: 'Enter', NumpadEnter: 'Enter',
  Escape: 'Esc', Tab: 'Tab', Backspace: '⌫', Delete: 'Entf',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Minus: '−', Equal: '=', Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'',
};

function codeToLabel(code) {
  if (!code) return '?';
  if (code.startsWith('Key')) return code.slice(3);        // KeyR   -> R
  if (code.startsWith('Digit')) return code.slice(5);      // Digit1 -> 1
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (KEY_LABEL[code]) return KEY_LABEL[code];
  if (/^F\d{1,2}$/.test(code)) return code;                // F1..F12
  return code;
}

const MOUSE_LABEL = {
  1: 'Mittlere Maustaste',
  2: 'Rechte Maustaste',
  3: 'Maustaste zurück',
  4: 'Maustaste vor',
};

function hotkeyLabel(hk) {
  if (!hk) return 'Nicht belegt';
  if (hk.type === 'mouse') return MOUSE_LABEL[hk.button] || ('Maustaste ' + (hk.button + 1));
  const parts = [];
  if (hk.ctrl) parts.push('Strg');
  if (hk.alt) parts.push('Alt');
  if (hk.shift) parts.push('Umschalt');
  if (hk.meta) parts.push('Meta');
  parts.push(codeToLabel(hk.code));
  return parts.join(' + ');
}

/* ---------- Vergleich & Zuweisung ---------- */

function sameHotkey(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'mouse') return a.button === b.button;
  return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt &&
    a.shift === b.shift && a.meta === b.meta;
}

// Belegt eine Aktion; entfernt dieselbe Kombination von anderen Aktionen,
// damit ein Tastendruck nie zwei Dinge gleichzeitig auslöst.
function assignHotkey(action, hk) {
  HOTKEY_ACTIONS.forEach((other) => {
    if (other !== action && sameHotkey(hotkeys[other], hk)) delete hotkeys[other];
  });
  hotkeys[action] = hk;
  saveHotkeys();
}

/* ---------- Einstellungs-UI ---------- */

const hotkeyList = document.getElementById('hotkeyList');

function renderHotkeyUI() {
  if (!hotkeyList) return;
  hotkeyList.querySelectorAll('.hotkey-input').forEach((btn) => {
    const action = btn.dataset.hotkey;
    if (capturingAction === action) {
      btn.textContent = 'Taste oder Maustaste drücken …';
      btn.classList.add('capturing');
      btn.classList.remove('assigned');
    } else {
      btn.textContent = hotkeyLabel(hotkeys[action]);
      btn.classList.remove('capturing');
      btn.classList.toggle('assigned', !!hotkeys[action]);
    }
  });
}

function startCapture(action) {
  capturingAction = action;
  renderHotkeyUI();
}
function endCapture() {
  capturingAction = null;
  renderHotkeyUI();
}

if (hotkeyList) {
  hotkeyList.addEventListener('click', (e) => {
    const clearBtn = e.target.closest('.hotkey-clear');
    if (clearBtn) {
      delete hotkeys[clearBtn.dataset.hotkeyClear];
      saveHotkeys();
      if (capturingAction === clearBtn.dataset.hotkeyClear) capturingAction = null;
      renderHotkeyUI();
      return;
    }
    const setBtn = e.target.closest('.hotkey-input');
    if (!setBtn) return;
    // erneuter Klick auf das gerade lauschende Feld bricht ab
    if (capturingAction === setBtn.dataset.hotkey) { endCapture(); return; }
    startCapture(setBtn.dataset.hotkey);
  });
}

/* ---------- Erfassung (Capture-Phase, fängt vor allen anderen Handlern) ---------- */

const MODIFIER_KEYS = ['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS', 'ContextMenu'];

// Wichtig: stopImmediatePropagation (nicht nur stopPropagation) - die
// Auslöser-Listener unten hängen am selben Ziel (window). stopPropagation
// würde sie NICHT bremsen, sodass genau der Tastendruck, der ein Kürzel
// belegt, dessen Aktion sofort mit auslösen würde.
window.addEventListener('keydown', (e) => {
  if (!capturingAction) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === 'Escape') { endCapture(); return; }
  if (MODIFIER_KEYS.includes(e.key)) return; // Modifier allein zählt nicht
  if (!e.code) { endCapture(); return; }
  assignHotkey(capturingAction, {
    type: 'key', code: e.code,
    ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey,
  });
  endCapture();
}, true);

window.addEventListener('mousedown', (e) => {
  if (!capturingAction) return;
  // Klicks auf die Kürzel-Felder selbst sind Bedienung, keine Belegung.
  if (e.target.closest('.hotkey-input, .hotkey-clear')) return;
  // Linke Maustaste bleibt reserviert - ein Linksklick daneben bricht ab.
  if (e.button === 0) { endCapture(); return; }
  e.preventDefault();
  e.stopImmediatePropagation();
  assignHotkey(capturingAction, { type: 'mouse', button: e.button });
  endCapture();
}, true);

// Kontextmenü / Seiten-Navigation der Sondertasten während der Erfassung
// unterdrücken, damit sie sich sauber als Kürzel abgreifen lassen.
window.addEventListener('contextmenu', (e) => { if (capturingAction) e.preventDefault(); }, true);
window.addEventListener('auxclick', (e) => {
  if (capturingAction) { e.preventDefault(); e.stopPropagation(); }
}, true);

/* ---------- Globale Auslöser (Bubble-Phase) ---------- */

// Kürzel ohne Modifier dürfen fokussierte Bedienelemente/Eingaben nicht
// kapern (dort haben Leertaste/Enter/Buchstaben eigene Bedeutung).
function isInteractiveTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(el.tagName)) return true;
  return el.getAttribute && el.getAttribute('role') === 'button';
}

function keyEventMatches(hk, e) {
  return hk && hk.type === 'key' && e.code === hk.code &&
    e.ctrlKey === hk.ctrl && e.altKey === hk.alt &&
    e.shiftKey === hk.shift && e.metaKey === hk.meta;
}
function mouseEventMatches(hk, e) {
  return hk && hk.type === 'mouse' && e.button === hk.button;
}

function runAction(action) {
  if (action === 'record') toggleRecordingFromHotkey();
  else if (action === 'projectNext') stepProject(1);
  else if (action === 'projectPrev') stepProject(-1);
}

window.addEventListener('keydown', (e) => {
  if (capturingAction || e.repeat) return;
  const inField = isInteractiveTarget(document.activeElement);
  for (const action of HOTKEY_ACTIONS) {
    const hk = hotkeys[action];
    if (!keyEventMatches(hk, e)) continue;
    if (inField && !hk.ctrl && !hk.alt && !hk.meta) return; // Bedienelement macht seins
    e.preventDefault();
    runAction(action);
    return;
  }
});

window.addEventListener('mousedown', (e) => {
  if (capturingAction) return;
  for (const action of HOTKEY_ACTIONS) {
    if (!mouseEventMatches(hotkeys[action], e)) continue;
    e.preventDefault(); // Autoscroll (Mitte) bzw. Navigation (Seiten) unterbinden
    runAction(action);
    return;
  }
});

// Zusätzlich den Klick-Standard der Sonder-/Mitteltasten unterbinden, wenn
// sie belegt sind - sonst navigiert der Browser trotzdem vor/zurück.
window.addEventListener('auxclick', (e) => {
  if (capturingAction) return;
  for (const action of HOTKEY_ACTIONS) {
    if (mouseEventMatches(hotkeys[action], e)) { e.preventDefault(); return; }
  }
});

renderHotkeyUI();
