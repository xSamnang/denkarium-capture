// --- Darstellung anpassen: Farbe innen (Button) und außen (Hintergrund) ---

const INNER_COLOR_KEY = 'denkarium_inner_color';
const OUTER_MODE_KEY = 'denkarium_outer_mode'; // 'starfield' | Farbname | 'photo'
const OUTER_PHOTO_KEY = 'denkarium_outer_photo'; // Daten-URL, nur bei mode === 'photo'

const SWATCH_COLORS = {
  black: '#000000',
  white: '#ffffff',
  violet: '#7c4dff',
  green: '#2ecc71',
  lightblue: '#4fc3f7',
};

const recordButtonEl = document.getElementById('recordButton');
const spaceEl = document.querySelector('.space');
const dustEl = document.querySelector('.dust');
const innerSwatches = document.getElementById('innerSwatches');
const outerSwatches = document.getElementById('outerSwatches');
const bgPhotoInput = document.getElementById('bgPhotoInput');

function applyInnerColor(colorKey) {
  recordButtonEl.style.background = SWATCH_COLORS[colorKey] || SWATCH_COLORS.black;
}

function applyOuterAppearance(mode, photoDataUrl) {
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

function loadAppearance() {
  const innerColor = localStorage.getItem(INNER_COLOR_KEY) || 'black';
  const outerMode = localStorage.getItem(OUTER_MODE_KEY) || 'starfield';
  const outerPhoto = localStorage.getItem(OUTER_PHOTO_KEY);
  applyInnerColor(innerColor);
  applyOuterAppearance(outerMode, outerPhoto);
  markSelectedSwatch(innerSwatches, innerColor);
  markSelectedSwatch(outerSwatches, outerMode);
}

innerSwatches.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch');
  if (!btn) return;
  const color = btn.dataset.color;
  localStorage.setItem(INNER_COLOR_KEY, color);
  applyInnerColor(color);
  markSelectedSwatch(innerSwatches, color);
});

outerSwatches.addEventListener('click', (e) => {
  const btn = e.target.closest('.swatch');
  if (!btn) return;
  const mode = btn.dataset.color;
  if (mode === 'photo') {
    bgPhotoInput.click();
    return;
  }
  localStorage.setItem(OUTER_MODE_KEY, mode);
  localStorage.removeItem(OUTER_PHOTO_KEY);
  applyOuterAppearance(mode, null);
  markSelectedSwatch(outerSwatches, mode);
});

bgPhotoInput.addEventListener('change', async () => {
  const file = bgPhotoInput.files && bgPhotoInput.files[0];
  bgPhotoInput.value = '';
  if (!file) return;
  try {
    const dataUrl = await downscaleImage(file, 1600);
    localStorage.setItem(OUTER_MODE_KEY, 'photo');
    localStorage.setItem(OUTER_PHOTO_KEY, dataUrl);
    applyOuterAppearance('photo', dataUrl);
    markSelectedSwatch(outerSwatches, 'photo');
  } catch (err) {
    console.error('Hintergrundbild konnte nicht geladen werden:', err);
  }
});

loadAppearance();
