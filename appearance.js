// --- Erscheinungsbild: Hell/Dunkel/Custom-Umschalter + Custom-Presets ---
// Hell und Dunkel sind feste Vorgaben. Im Custom-Modus lassen sich Farbe
// innen/außen und die Ring-Akzentfarbe frei wählen und in bis zu 3 Presets
// gespeichert werden.

const THEME_MODE_KEY = 'denkarium_theme_mode';
const ACTIVE_PRESET_KEY = 'denkarium_active_preset';
const PRESETS_KEY = 'denkarium_custom_presets';
const DEFAULT_RING_COLOR = '#ff9a3c';
const DEFAULT_UI_ACCENT = '#1a1a1a';

const SWATCH_COLORS = {
  black: '#000000',
  white: '#ffffff',
  violet: '#7c4dff',
  green: '#2ecc71',
  lightblue: '#4fc3f7',
};

function defaultPreset() {
  return { inner: 'black', outer: 'starfield', outerPhoto: null, ring: DEFAULT_RING_COLOR, uiAccent: DEFAULT_UI_ACCENT };
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

const recordButtonEl = document.getElementById('recordButton');
const spaceEl = document.querySelector('.space');
const dustEl = document.querySelector('.dust');
const themeSwitcher = document.getElementById('themeSwitcher');
const presetRow = document.getElementById('presetRow');
const innerSwatches = document.getElementById('innerSwatches');
const outerSwatches = document.getElementById('outerSwatches');
const bgPhotoInput = document.getElementById('bgPhotoInput');
const ringColorInput = document.getElementById('ringColorInput');
const uiAccentInput = document.getElementById('uiAccentInput');
const ringToggle = document.getElementById('ringToggle');
const stageEl = document.querySelector('.stage');
const RING_ENABLED_KEY = 'denkarium_ring_enabled';

function isRingEnabled() {
  const v = localStorage.getItem(RING_ENABLED_KEY);
  return v === null ? true : v === '1';
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

function setRingColor(hex) {
  document.documentElement.style.setProperty('--ring-color', hex);
}

function contrastingTextColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? '#111111' : '#ffffff';
}

function setUiAccent(hex) {
  document.documentElement.style.setProperty('--ui-accent', hex);
  document.documentElement.style.setProperty('--ui-accent-fg', contrastingTextColor(hex));
}

function setInnerColor(colorKey) {
  recordButtonEl.style.background = SWATCH_COLORS[colorKey] || '#000000';
}

function setOuterBackground(mode, photoDataUrl) {
  if (mode === 'photo' && photoDataUrl) {
    spaceEl.hidden = true;
    dustEl.hidden = true;
    document.body.style.backgroundImage = `url("${photoDataUrl}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundColor = '#05060c';
  } else if (SWATCH_COLORS[mode]) {
    spaceEl.hidden = true;
    dustEl.hidden = true;
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = SWATCH_COLORS[mode];
  } else {
    // 'starfield' (Standard)
    spaceEl.hidden = false;
    dustEl.hidden = false;
    document.body.style.backgroundImage = '';
    document.body.style.backgroundColor = '#05060c';
  }
}

function markSelectedSwatch(container, value) {
  container.querySelectorAll('.swatch').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.color === value);
  });
}

function markActivePresetButton() {
  presetRow.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.preset) === activePresetIndex);
  });
}

function currentThemeMode() {
  return localStorage.getItem(THEME_MODE_KEY) || 'light';
}

function applyTheme() {
  const mode = currentThemeMode();

  if (mode === 'light') {
    setInnerColor('black');
    setOuterBackground('white', null);
    setRingColor(DEFAULT_RING_COLOR);
    setUiAccent('#222222');
  } else if (mode === 'dark') {
    setInnerColor('white');
    setOuterBackground('black', null);
    setRingColor(DEFAULT_RING_COLOR);
    setUiAccent('#ffffff');
  } else {
    const preset = presets[activePresetIndex] || defaultPreset();
    setInnerColor(preset.inner);
    setOuterBackground(preset.outer, preset.outerPhoto);
    setRingColor(preset.ring || DEFAULT_RING_COLOR);
    setUiAccent(preset.uiAccent || DEFAULT_UI_ACCENT);
  }

  themeSwitcher.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const activePreset = presets[activePresetIndex] || defaultPreset();
  markSelectedSwatch(innerSwatches, activePreset.inner);
  markSelectedSwatch(outerSwatches, activePreset.outer);
  ringColorInput.value = activePreset.ring || DEFAULT_RING_COLOR;
  uiAccentInput.value = activePreset.uiAccent || DEFAULT_UI_ACCENT;
  markActivePresetButton();
}

function switchToCustomMode() {
  localStorage.setItem(THEME_MODE_KEY, 'custom');
}

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

innerSwatches.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch');
  if (!btn) return;
  presets[activePresetIndex].inner = btn.dataset.color;
  savePresets();
  switchToCustomMode();
  applyTheme();
});

outerSwatches.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch');
  if (!btn) return;
  const mode = btn.dataset.color;
  if (mode === 'photo') { bgPhotoInput.click(); return; }
  presets[activePresetIndex].outer = mode;
  presets[activePresetIndex].outerPhoto = null;
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
    presets[activePresetIndex].outer = 'photo';
    presets[activePresetIndex].outerPhoto = dataUrl;
    savePresets();
    switchToCustomMode();
    applyTheme();
  } catch (err) {
    console.error('Hintergrundbild konnte nicht geladen werden:', err);
  }
});

ringColorInput.addEventListener('input', () => {
  presets[activePresetIndex].ring = ringColorInput.value;
  savePresets();
  switchToCustomMode();
  applyTheme();
});

uiAccentInput.addEventListener('input', () => {
  presets[activePresetIndex].uiAccent = uiAccentInput.value;
  savePresets();
  switchToCustomMode();
  applyTheme();
});

applyTheme();
applyRingEnabled();
