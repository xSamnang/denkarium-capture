// --- Aufnahme-Button: Druck-Feedback + lautstärke-reaktiver Lichtring ---
const recordButton = document.getElementById('recordButton');
const lensHalo = document.getElementById('lensHalo');
const liveCaption = document.getElementById('liveCaption');
const baseRingDuration = 3.5;

let rafId = null;
let audioCtx, analyser, dataArray, stream;
let recording = false;

// --- Sprach-zu-Text (Web Speech API) ---
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let finalTranscript = '';
let recognitionShouldRun = false;

if (SpeechRecognitionImpl) {
  recognition = new SpeechRecognitionImpl();
  recognition.lang = 'de-DE';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.addEventListener('result', (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += chunk + ' ';
      } else {
        interim += chunk;
      }
    }
    liveCaption.textContent = (finalTranscript + interim).trim();
  });

  recognition.addEventListener('error', (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showToast('Mikrofon-Zugriff für Spracherkennung verweigert');
    }
  });

  // manche Browser beenden die Erkennung nach kurzer Sprechpause von sich aus -
  // solange noch aufgenommen wird, einfach neu starten
  recognition.addEventListener('end', () => {
    if (recognitionShouldRun) {
      try { recognition.start(); } catch (e) { /* already running */ }
    }
  });
}

function applyVolume(volume01) {
  const clamped = Math.max(0, Math.min(1, volume01));
  const factor = Math.max(0.12, 1 - clamped * 0.88);
  lensHalo.style.animationDuration = (baseRingDuration * factor) + 's';
  lensHalo.style.opacity = (0.85 + clamped * 0.15).toFixed(2);
}

function idleLoop(t) {
  if (!recording) {
    const breathing = (Math.sin(t / 1800) * 0.5 + 0.5) * 0.1;
    applyVolume(breathing);
  }
  rafId = requestAnimationFrame(idleLoop);
}

function recordingTick() {
  if (!recording) return;
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
  applyVolume(sum / dataArray.length / 255);
  rafId = requestAnimationFrame(recordingTick);
}

async function startRecording() {
  recordButton.classList.add('pressed');
  recording = true;

  finalTranscript = '';
  liveCaption.textContent = '';
  liveCaption.hidden = false;
  if (recognition) {
    recognitionShouldRun = true;
    try { recognition.start(); } catch (e) { /* already running */ }
  } else {
    liveCaption.textContent = 'Spracherkennung wird von diesem Browser nicht unterstützt – Text manuell eingeben.';
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    cancelAnimationFrame(rafId);
    recordingTick();
  } catch (err) {
    console.warn('Mikrofonzugriff fehlgeschlagen:', err.message);
  }
}

function stopRecording() {
  recordButton.classList.remove('pressed');
  recording = false;
  liveCaption.hidden = true;

  if (recognition) {
    recognitionShouldRun = false;
    recognition.stop();
  }

  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  cancelAnimationFrame(rafId);
  idleLoop(performance.now());

  openTextEntry(finalTranscript.trim());
}

recordButton.addEventListener('pointerdown', startRecording);
['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) =>
  recordButton.addEventListener(evt, stopRecording)
);

idleLoop(performance.now());

// --- Toast-Hinweis (Platzhalter-Feedback für noch nicht fertige Funktionen) ---
const toast = document.getElementById('toast');
let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// --- Stift-Icon: manuelle Text-Notiz ---
const pencilBtn = document.getElementById('pencilBtn');
const textEntry = document.getElementById('textEntry');
const textEntryInput = document.getElementById('textEntryInput');
const textEntryCancel = document.getElementById('textEntryCancel');
const textEntrySave = document.getElementById('textEntrySave');

function openTextEntry(prefillText) {
  textEntry.hidden = false;
  textEntryInput.value = prefillText || '';
  textEntryInput.focus();
}

pencilBtn.addEventListener('click', () => openTextEntry(''));
textEntryCancel.addEventListener('click', () => { textEntry.hidden = true; });
textEntrySave.addEventListener('click', () => {
  textEntry.hidden = true;
  showToast('Gespeichert (Ablage folgt in einer späteren Phase)');
});

// --- Büroklammer-Icon: Datei anhängen ---
const paperclipBtn = document.getElementById('paperclipBtn');
const fileInput = document.getElementById('fileInput');

paperclipBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) {
    showToast(`Ausgewählt: ${fileInput.files[0].name} (Upload folgt in einer späteren Phase)`);
    fileInput.value = '';
  }
});

// --- Swipe-Archiv-Menü ---
const archivePanel = document.getElementById('archivePanel');
const archiveBackdrop = document.getElementById('archiveBackdrop');
const archiveClose = document.getElementById('archiveClose');

function openArchive() {
  archivePanel.classList.add('open');
  archiveBackdrop.classList.add('open');
  archivePanel.setAttribute('aria-hidden', 'false');
}
function closeArchive() {
  archivePanel.classList.remove('open');
  archiveBackdrop.classList.remove('open');
  archivePanel.setAttribute('aria-hidden', 'true');
}

archiveClose.addEventListener('click', closeArchive);
archiveBackdrop.addEventListener('click', closeArchive);

// --- PIN-Schutz fürs Archiv ---
const PIN_STORAGE_KEY = 'denkarium_pin_hash';
const pinGate = document.getElementById('pinGate');
const pinTitle = document.getElementById('pinTitle');
const pinError = document.getElementById('pinError');
const pinDots = document.getElementById('pinDots');
const pinKeypad = document.getElementById('pinKeypad');
const pinCancel = document.getElementById('pinCancel');
const pinDelete = document.getElementById('pinDelete');

let pinEntered = '';
let pinMode = 'verify'; // 'verify' | 'set' | 'confirm'
let pinFirstEntry = '';

async function sha256(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderPinDots() {
  [...pinDots.children].forEach((dot, i) => dot.classList.toggle('filled', i < pinEntered.length));
}

function openPinGate() {
  pinEntered = '';
  pinError.textContent = '';
  const hasPin = !!localStorage.getItem(PIN_STORAGE_KEY);
  pinMode = hasPin ? 'verify' : 'set';
  pinTitle.textContent = hasPin ? 'PIN eingeben' : 'Neue PIN festlegen';
  renderPinDots();
  pinGate.hidden = false;
}

function closePinGate() {
  pinGate.hidden = true;
  pinEntered = '';
}

function shakePinDots(message) {
  pinError.textContent = message;
  pinDots.classList.remove('shake');
  // reflow erzwingen, damit die Animation bei wiederholtem Fehler erneut abspielt
  void pinDots.offsetWidth;
  pinDots.classList.add('shake');
  pinEntered = '';
  renderPinDots();
}

async function submitPin() {
  if (pinMode === 'set') {
    pinFirstEntry = pinEntered;
    pinEntered = '';
    pinMode = 'confirm';
    pinTitle.textContent = 'PIN bestätigen';
    renderPinDots();
    return;
  }

  if (pinMode === 'confirm') {
    if (pinEntered !== pinFirstEntry) {
      pinMode = 'set';
      pinFirstEntry = '';
      pinTitle.textContent = 'Neue PIN festlegen';
      shakePinDots('PINs stimmten nicht überein – bitte erneut eingeben');
      return;
    }
    localStorage.setItem(PIN_STORAGE_KEY, await sha256(pinEntered));
    closePinGate();
    openArchive();
    return;
  }

  // mode 'verify'
  const hash = await sha256(pinEntered);
  if (hash === localStorage.getItem(PIN_STORAGE_KEY)) {
    closePinGate();
    openArchive();
  } else {
    shakePinDots('Falsche PIN');
  }
}

pinKeypad.addEventListener('click', (e) => {
  const key = e.target.closest('[data-key]');
  if (!key || pinEntered.length >= 4) return;
  pinEntered += key.dataset.key;
  renderPinDots();
  if (pinEntered.length === 4) submitPin();
});
pinDelete.addEventListener('click', () => {
  pinEntered = pinEntered.slice(0, -1);
  renderPinDots();
});
pinCancel.addEventListener('click', closePinGate);

let touchStartX = null;
let touchStartY = null;

document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = Math.abs(t.clientY - touchStartY);

  const panelOpen = archivePanel.classList.contains('open');
  if (!panelOpen && touchStartX < 40 && dx > 70 && dy < 60) {
    openPinGate();
  } else if (panelOpen && dx < -70 && dy < 60) {
    closeArchive();
  }
  touchStartX = null;
  touchStartY = null;
}, { passive: true });
