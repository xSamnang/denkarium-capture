// --- Erscheinungsbild: Hell/Dunkel/Custom + Presets + Farbrad ---
// Hell und Dunkel sind feste Vorgaben (inkl. eigener Akzentfarbe fürs UI).
// Im Custom-Modus wählt man über das Farbrad je Ziel (Kreis, Hintergrund,
// Ring, Buttons) eine Farbe; bis zu 3 Presets sind speicherbar.

const THEME_MODE_KEY = 'denkarium_theme_mode';
const ACTIVE_PRESET_KEY = 'denkarium_active_preset';
const PRESETS_KEY = 'denkarium_custom_presets';
const RING_ENABLED_KEY = 'denkarium_ring_enabled';
const VIBRATE_KEY = 'denkarium_vibrate';
const DEFAULT_RING_COLOR = '#ff9a3c';
// Custom startet im hellen Menü-Stil (wie style.css [data-theme="custom"]);
// ein sattes Violett statt des Orange aus dem hellen Modus hält den Akzent
// trotzdem klar von Hell/Dunkel unterscheidbar.
const DEFAULT_UI_ACCENT = '#7c3aed';

// Legacy: ältere Presets speicherten Farbnamen statt Hex-Werte
const SWATCH_COLORS = {
  black: '#000000',
  white: '#ffffff',
  warmgray: '#78716c',
  red: '#ff5252',
  orange: '#ff9800',
  yellow: '#ffca28',
  green: '#2ecc71',
  teal: '#26c6da',
  lightblue: '#4fc3f7',
  indigo: '#5c6bc0',
  violet: '#7c4dff',
  pink: '#ec407a',
};

function resolveColor(value, fallback) {
  if (typeof value === 'string' && value.startsWith('#')) return value;
  return SWATCH_COLORS[value] || fallback || '#000000';
}

function defaultPreset() {
  return { inner: '#000000', outer: '#ffffff', outerPhoto: null, ring: DEFAULT_RING_COLOR, uiAccent: DEFAULT_UI_ACCENT };
}

function loadPresets() {
  const raw = localStorage.getItem(PRESETS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === 3) return parsed;
    } catch (e) { /* Presets waren beschädigt - Standard verwenden */ }
  }
  return [defaultPreset(), defaultPreset(), defaultPreset()];
}

function savePresets() {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

let presets = loadPresets();
let activePresetIndex = Number(localStorage.getItem(ACTIVE_PRESET_KEY) || 0);
if (!(activePresetIndex >= 0 && activePresetIndex <= 2)) activePresetIndex = 0;

const recordButtonEl = document.getElementById('recordButton');
const spaceEl = document.querySelector('.space');
const dustEl = document.querySelector('.dust');
const stageEl = document.querySelector('.stage');
const themeSwitcher = document.getElementById('themeSwitcher');
const presetRow = document.getElementById('presetRow');
const bgPhotoInput = document.getElementById('bgPhotoInput');
const ringToggle = document.getElementById('ringToggle');
const vibrationToggle = document.getElementById('vibrationToggle');
const colorTargets = document.getElementById('colorTargets');
const colorWheel = document.getElementById('colorWheel');
const wheelCursor = document.getElementById('wheelCursor');
const neutralChips = document.getElementById('neutralChips');
const outerSpecials = document.getElementById('outerSpecials');

/* ---------- Farb-Helfer ---------- */

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// liefert den Farbton (0-360) eines Hex-Werts, oder null bei Grautönen
function hexToHue(hex) {
  const c = hex.replace('#', '');
  if (c.length !== 6) return null;
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.08) return null; // praktisch grau/schwarz/weiß
  let h;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

function relLuminance(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function contrastingTextColor(hex) {
  return relLuminance(hex) > 0.55 ? '#111111' : '#ffffff';
}

function mixHex(hex, target, t) {
  const a = hex.replace('#', '');
  const b = target.replace('#', '');
  const ch = (i) => {
    const x = parseInt(a.substring(i, i + 2), 16);
    const y = parseInt(b.substring(i, i + 2), 16);
    return Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

// Akzentfarbe so abdunkeln, dass sie als Text/Symbol auf der hellen
// Menüfläche (Custom-Modus) sicher lesbar bleibt - eine sehr helle
// Akzentwahl würde sonst mit dem weißen Hintergrund verschwimmen.
function readableAccentOnLight(hex) {
  let t = 0;
  let out = hex;
  while (relLuminance(out) > 0.55 && t < 1) {
    t += 0.12;
    out = mixHex(hex, '#000000', t);
  }
  return out;
}

/* ---------- Einstellungen: Ring & Vibration ---------- */

function isRingEnabled() {
  const v = localStorage.getItem(RING_ENABLED_KEY);
  return v === null ? false : v === '1';
}

function applyRingEnabled() {
  const enabled = isRingEnabled();
  stageEl.classList.toggle('ring-disabled', !enabled);
  ringToggle.checked = enabled;
}

ringToggle.addEventListener('change', () => {
  localStorage.setItem(RING_ENABLED_KEY, ringToggle.checked ? '1' : '0');
  applyRingEnabled();
});

function isVibrationEnabled() {
  const v = localStorage.getItem(VIBRATE_KEY);
  return v === null ? true : v === '1';
}

vibrationToggle.checked = isVibrationEnabled();
vibrationToggle.addEventListener('change', () => {
  localStorage.setItem(VIBRATE_KEY, vibrationToggle.checked ? '1' : '0');
});

/* ---------- Theme anwenden ---------- */

function setRingColor(hex) {
  document.documentElement.style.setProperty('--ring-color', hex);
}

function setAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-fg', contrastingTextColor(hex));
  // Custom-Modus nutzt die helle Menüfläche - Text/Symbole in Akzentfarbe
  // werden bei Bedarf abgedunkelt, damit sie immer lesbar bleiben.
  document.documentElement.style.setProperty('--accent-strong', readableAccentOnLight(hex));
}

function clearAccentOverride() {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-fg');
  document.documentElement.style.removeProperty('--accent-strong');
}

function setInnerColor(value) {
  recordButtonEl.style.background = resolveColor(value, '#000000');
}

function setOuterBackground(mode, photoDataUrl) {
  if (mode === 'photo' && photoDataUrl) {
    spaceEl.hidden = true;
    dustEl.hidden = true;
    document.body.style.backgroundImage = `url("${photoDataUrl}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundColor = '#05060c';
  } else if (mode !== 'starfield') {
    spaceEl.hidden = true;
    dustEl.hidden = true;
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = resolveColor(mode, '#05060c');
  } else {
    spaceEl.hidden = false;
    dustEl.hidden = false;
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = '#05060c';
  }
}

function currentThemeMode() {
  return localStorage.getItem(THEME_MODE_KEY) || 'light';
}

function activePreset() {
  return presets[activePresetIndex] || defaultPreset();
}

function applyTheme() {
  const mode = currentThemeMode();
  document.documentElement.dataset.theme = mode;

  if (mode === 'light') {
    setInnerColor('#000000');
    setOuterBackground('#ffffff', null);
    setRingColor(DEFAULT_RING_COLOR);
    clearAccentOverride();
  } else if (mode === 'dark') {
    setInnerColor('#ffffff');
    setOuterBackground('#000000', null);
    setRingColor(DEFAULT_RING_COLOR);
    clearAccentOverride();
  } else {
    const preset = activePreset();
    setInnerColor(preset.inner);
    setOuterBackground(preset.outer, preset.outerPhoto);
    setRingColor(resolveColor(preset.ring, DEFAULT_RING_COLOR));
    setAccent(resolveColor(preset.uiAccent, DEFAULT_UI_ACCENT));
  }

  themeSwitcher.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  presetRow.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.preset) === activePresetIndex);
  });

  updateColorUI();
}

function switchToCustomMode() {
  localStorage.setItem(THEME_MODE_KEY, 'custom');
}

/* ---------- Farbrad & Ziel-Auswahl ---------- */

let colorTarget = 'inner'; // 'inner' | 'outer' | 'ring' | 'ui'

function getTargetValue(target) {
  const p = activePreset();
  if (target === 'inner') return p.inner;
  if (target === 'outer') return p.outer;
  if (target === 'ring') return p.ring;
  return p.uiAccent;
}

function setTargetValue(target, hex) {
  const p = activePreset();
  if (target === 'inner') p.inner = hex;
  else if (target === 'outer') { p.outer = hex; p.outerPhoto = null; }
  else if (target === 'ring') p.ring = hex;
  else p.uiAccent = hex;
  savePresets();
  switchToCustomMode();
  applyTheme();
}

function positionWheelCursor(hue) {
  const size = colorWheel.clientWidth;
  if (!size) { wheelCursor.hidden = true; return; }
  const r = size * 0.335; // Mitte des Farbrings
  const theta = ((hue + 90) * Math.PI) / 180;
  const x = size / 2 + r * Math.sin(theta);
  const y = size / 2 - r * Math.cos(theta);
  wheelCursor.style.left = `${x}px`;
  wheelCursor.style.top = `${y}px`;
  wheelCursor.style.background = hslToHex(hue, 85, 55);
  wheelCursor.hidden = false;
}

function updateColorUI() {
  const p = activePreset();

  // Farb-Punkte in den Ziel-Chips
  colorTargets.querySelectorAll('.chip-dot').forEach((dot) => {
    const which = dot.dataset.dot;
    dot.classList.remove('chip-dot--starfield', 'chip-dot--photo');
    if (which === 'outer' && p.outer === 'starfield') {
      dot.style.background = '';
      dot.classList.add('chip-dot--starfield');
    } else if (which === 'outer' && p.outer === 'photo') {
      dot.style.background = '';
      dot.classList.add('chip-dot--photo');
    } else {
      dot.style.background = resolveColor(getTargetValue(which),
        which === 'ring' ? DEFAULT_RING_COLOR : '#000000');
    }
  });

  // Spezial-Optionen (Sterne/Foto) nur für den Hintergrund
  outerSpecials.hidden = colorTarget !== 'outer';

  // Rad-Cursor auf aktuelle Farbe setzen (bei Grau/Spezial ausblenden)
  const value = getTargetValue(colorTarget);
  if (colorTarget === 'outer' && (value === 'starfield' || value === 'photo')) {
    wheelCursor.hidden = true;
    return;
  }
  const hue = hexToHue(resolveColor(value, '#000000'));
  if (hue === null) {
    wheelCursor.hidden = true;
  } else {
    positionWheelCursor(hue);
  }
}

colorTargets.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  colorTarget = chip.dataset.target;
  colorTargets.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
  updateColorUI();
});

function handleWheelPointer(e) {
  const rect = colorWheel.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  const thetaConic = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° = oben, im Uhrzeigersinn
  const hue = ((thetaConic - 90) % 360 + 360) % 360;        // Rad startet rechts bei Rot
  const hex = hslToHex(hue, 85, 55);
  setTargetValue(colorTarget, hex);
}

let wheelActive = false;
colorWheel.addEventListener('pointerdown', (e) => {
  wheelActive = true;
  try { colorWheel.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
  handleWheelPointer(e);
});
colorWheel.addEventListener('pointermove', (e) => {
  if (wheelActive) handleWheelPointer(e);
});
['pointerup', 'pointercancel'].forEach((evt) =>
  colorWheel.addEventListener(evt, () => { wheelActive = false; })
);

neutralChips.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-hex]');
  if (!btn) return;
  setTargetValue(colorTarget, btn.dataset.hex);
});

outerSpecials.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  if (btn.dataset.mode === 'photo') { bgPhotoInput.click(); return; }
  const p = activePreset();
  p.outer = 'starfield';
  p.outerPhoto = null;
  savePresets();
  switchToCustomMode();
  applyTheme();
});

bgPhotoInput.addEventListener('change', async () => {
  const file = bgPhotoInput.files && bgPhotoInput.files[0];
  bgPhotoInput.value = '';
  if (!file) return;
  try {
    const dataUrl = await downscaleImage(file, 1600);
    const p = activePreset();
    p.outer = 'photo';
    p.outerPhoto = dataUrl;
    savePresets();
    switchToCustomMode();
    applyTheme();
  } catch (err) {
    console.error('Hintergrundbild konnte nicht geladen werden:', err);
  }
});

function downscaleImage(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- Umschalter ---------- */

themeSwitcher.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  localStorage.setItem(THEME_MODE_KEY, btn.dataset.mode);
  applyTheme();
});

presetRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.preset-btn');
  if (!btn) return;
  activePresetIndex = Number(btn.dataset.preset);
  localStorage.setItem(ACTIVE_PRESET_KEY, String(activePresetIndex));
  switchToCustomMode();
  applyTheme();
});

applyTheme();
applyRingEnabled();
