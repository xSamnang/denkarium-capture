// --- Aufnahme-Button: Druck-Feedback + lautstärke-reaktiver Lichtring ---
const recordButton = document.getElementById('recordButton');
const lensHalo = document.getElementById('lensHalo');
const liveCaption = document.getElementById('liveCaption');
const cancelTrash = document.getElementById('cancelTrash');
const lockIndicator = document.getElementById('lockIndicator');
const baseRingDuration = 3.5;

let rafId = null;
let audioCtx, analyser, dataArray, stream;
let recording = false;
let locked = false;
let pendingCancel = false;
let pressStartX = 0;
let pressStartY = 0;

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

  if (recording) {
    recordButton.style.transform = `scale(${1.05 + clamped * 0.08})`;
    recordButton.style.boxShadow = `0 0 0 ${8 + clamped * 22}px rgba(255,255,255,${(0.05 + clamped * 0.12).toFixed(2)})`;
  }
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
  recordButton.classList.add('recording');
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
    showToast('Kein Mikrofonzugriff – prüfe die Berechtigung in den Browser-Einstellungen');
  }
}

function stopRecordingInternals() {
  recordButton.classList.remove('recording');
  recordButton.style.transform = '';
  recordButton.style.boxShadow = '';
  recording = false;
  locked = false;
  liveCaption.hidden = true;
  cancelTrash.hidden = true;
  cancelTrash.classList.remove('armed');
  lockIndicator.hidden = true;
  pendingCancel = false;

  if (recognition) {
    recognitionShouldRun = false;
    recognition.stop();
  }

  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  cancelAnimationFrame(rafId);
  idleLoop(performance.now());
}

function stopRecording() {
  stopRecordingInternals();
  openTextEntry(finalTranscript.trim());
}

function cancelRecording() {
  stopRecordingInternals();
  finalTranscript = '';
  showToast('Aufnahme verworfen');
}

function engageLock() {
  locked = true;
  lockIndicator.hidden = false;
  cancelTrash.hidden = true;
  cancelTrash.classList.remove('armed');
  pendingCancel = false;
  document.removeEventListener('pointermove', onRecordPointerMove);
}

function onRecordPointerMove(e) {
  if (!recording || locked) return;
  const dx = e.clientX - pressStartX;
  const dy = e.clientY - pressStartY;

  // nach unten ziehen -> Sperren (freihändige Aufnahme)
  if (dy > 70 && Math.abs(dx) < 60) {
    engageLock();
    return;
  }

  // zum Mülleimer ziehen -> Abbrechen, sobald losgelassen
  const trashRect = cancelTrash.getBoundingClientRect();
  const trashCenterX = trashRect.left + trashRect.width / 2;
  const trashCenterY = trashRect.top + trashRect.height / 2;
  const dist = Math.hypot(e.clientX - trashCenterX, e.clientY - trashCenterY);
  pendingCancel = dist < 45;
  cancelTrash.classList.toggle('armed', pendingCancel);
}

function onRecordPointerDown(e) {
  if (recording && locked) {
    // Tippen während gesperrter Aufnahme beendet sie
    stopRecording();
    return;
  }
  if (recording) return;

  pressStartX = e.clientX;
  pressStartY = e.clientY;
  locked = false;
  pendingCancel = false;
  cancelTrash.hidden = false;
  cancelTrash.classList.remove('armed');
  lockIndicator.hidden = true;

  if (navigator.vibrate) navigator.vibrate(15);

  // Pointer an den Button binden, damit pointerup/-move zuverlässig
  // ankommen, auch wenn der Finger beim Ziehen (Sperren/Abbrechen) den
  // Button verlässt.
  try { recordButton.setPointerCapture(e.pointerId); } catch (err) { /* nicht unterstützt */ }

  document.addEventListener('pointermove', onRecordPointerMove);
  startRecording();
}

function onRecordPointerUp() {
  document.removeEventListener('pointermove', onRecordPointerMove);
  if (!recording || locked) return; // im gesperrten Zustand läuft die Aufnahme weiter

  if (pendingCancel) {
    cancelRecording();
  } else {
    stopRecording();
  }
}

recordButton.addEventListener('pointerdown', onRecordPointerDown);
// bewusst kein 'pointerleave' hier - beim Ziehen zum Sperren/Abbrechen
// verlässt der Finger den Button, die Aufnahme soll dabei aber weiterlaufen
['pointerup', 'pointercancel'].forEach((evt) =>
  recordButton.addEventListener(evt, onRecordPointerUp)
);

lockIndicator.addEventListener('click', () => {
  if (recording && locked) stopRecording();
});
lockIndicator.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && recording && locked) {
    e.preventDefault();
    stopRecording();
  }
});

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

// --- Letzte Einträge (max. 10, nur lokal - Drive-Dateien werden nie gelöscht) ---
const RECENT_ENTRIES_KEY = 'denkarium_recent_entries';
const recentEntriesList = document.getElementById('recentEntriesList');
const recentEmptyMsg = document.getElementById('recentEmptyMsg');

function loadRecentEntries() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_ENTRIES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

let recentEntries = loadRecentEntries();

function saveRecentEntries() {
  localStorage.setItem(RECENT_ENTRIES_KEY, JSON.stringify(recentEntries));
}

function renderRecentEntries() {
  recentEntriesList.querySelectorAll('.recent-entry').forEach((el) => el.remove());
  recentEmptyMsg.hidden = recentEntries.length > 0;
  recentEntries.forEach((entry, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-entry';
    btn.dataset.index = String(index);
    btn.innerHTML =
      `<span class="recent-entry__text"></span><span class="recent-entry__name"></span>`;
    btn.querySelector('.recent-entry__text').textContent = entry.text;
    btn.querySelector('.recent-entry__name').textContent = entry.name;
    recentEntriesList.appendChild(btn);
  });
}

function addRecentEntry(entry) {
  recentEntries.unshift(entry);
  recentEntries = recentEntries.slice(0, 10);
  saveRecentEntries();
  renderRecentEntries();
}

recentEntriesList.addEventListener('click', (e) => {
  const btn = e.target.closest('.recent-entry');
  if (!btn) return;
  const index = Number(btn.dataset.index);
  const entry = recentEntries[index];
  if (entry) openTextEntry(entry.text, index);
});

renderRecentEntries();

// --- Stift-Icon: manuelle Text-Notiz ---
const pencilBtn = document.getElementById('pencilBtn');
const textEntry = document.getElementById('textEntry');
const textEntryInput = document.getElementById('textEntryInput');
const textEntryCancel = document.getElementById('textEntryCancel');
const textEntrySave = document.getElementById('textEntrySave');

let editingEntryIndex = null;

function openTextEntry(prefillText, entryIndex) {
  editingEntryIndex = entryIndex === undefined ? null : entryIndex;
  textEntrySave.textContent = editingEntryIndex === null ? 'Speichern' : 'Weiter';
  textEntry.hidden = false;
  textEntryInput.value = prefillText || '';
  textEntryInput.focus();
}

pencilBtn.addEventListener('click', () => openTextEntry(''));
textEntryCancel.addEventListener('click', () => { textEntry.hidden = true; });
textEntrySave.addEventListener('click', async () => {
  const text = textEntryInput.value.trim();
  if (!text) { textEntry.hidden = true; return; }

  textEntrySave.disabled = true;
  showToast('Speichere in Google Drive …');
  try {
    if (editingEntryIndex !== null) {
      const original = recentEntries[editingEntryIndex];
      const result = await saveEditedVersion(original.name, text);
      recentEntries[editingEntryIndex] = { id: result.id, name: result.name, text, createdAt: original.createdAt };
      saveRecentEntries();
      renderRecentEntries();
    } else {
      const result = await saveNoteToDrive(text);
      addRecentEntry({ id: result.id, name: result.name, text, createdAt: Date.now() });
    }
    textEntry.hidden = true;
    showToast('In Google Drive gespeichert');
  } catch (err) {
    console.error('Speichern in Drive fehlgeschlagen:', err);
    if (err && (err.error === 'access_denied' || err.error === 'popup_closed_by_user')) {
      showToast('Google-Anmeldung abgebrochen – bitte erneut versuchen und auf "Weiter" klicken');
    } else {
      showToast('Fehler beim Speichern – bitte erneut versuchen');
    }
  } finally {
    textEntrySave.disabled = false;
  }
});

// --- Google-Drive-Ordner manuell ändern (im Menü) ---
document.getElementById('driveReconnectBtn').addEventListener('click', async () => {
  try {
    const token = await ensureAccessToken();
    const folderId = await pickInboxFolder(token);
    localStorage.setItem(INBOX_FOLDER_KEY, folderId);
    showToast('Inbox-Ordner aktualisiert');
  } catch (err) {
    showToast('Abgebrochen oder fehlgeschlagen');
  }
});

// --- Google-Drive-Ordner manuell ändern (im Archiv-Menü) ---
document.getElementById('driveReconnectBtn').addEventListener('click', async () => {
  try {
    const token = await ensureAccessToken();
    const folderId = await pickInboxFolder(token);
    localStorage.setItem(INBOX_FOLDER_KEY, folderId);
    showToast('Inbox-Ordner aktualisiert');
  } catch (err) {
    showToast('Abgebrochen oder fehlgeschlagen');
  }
});

// --- Büroklammer-Icon: Datei anhängen ---
const paperclipBtn = document.getElementById('paperclipBtn');
const fileInput = document.getElementById('fileInput');

paperclipBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  fileInput.value = '';

  showToast(`Lade "${file.name}" zu Google Drive hoch …`);
  try {
    await uploadFileToDrive(file);
    showToast(`"${file.name}" in Google Drive gespeichert`);
  } catch (err) {
    console.error('Datei-Upload fehlgeschlagen:', err);
    showToast('Fehler beim Hochladen – bitte erneut versuchen');
  }
});

// --- Swipe-up-Menü (Einstellungen / Letzte Einträge / Anleitung) ---
const menuSheet = document.getElementById('menuSheet');
const menuBackdrop = document.getElementById('menuBackdrop');
const menuClose = document.getElementById('menuClose');
const menuTabs = document.getElementById('menuTabs');

function openArchive() {
  menuSheet.classList.add('open');
  menuBackdrop.classList.add('open');
  menuSheet.setAttribute('aria-hidden', 'false');
}
function closeArchive() {
  menuSheet.classList.remove('open');
  menuBackdrop.classList.remove('open');
  menuSheet.setAttribute('aria-hidden', 'true');
}

menuClose.addEventListener('click', closeArchive);
menuBackdrop.addEventListener('click', closeArchive);

menuTabs.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.menu-tab');
  if (!tabBtn) return;
  const target = tabBtn.dataset.tab;
  menuTabs.querySelectorAll('.menu-tab').forEach((btn) => btn.classList.toggle('active', btn === tabBtn));
  menuSheet.querySelectorAll('.menu-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== target;
  });
});

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
  const dx = Math.abs(t.clientX - touchStartX);
  const dy = t.clientY - touchStartY; // negative = nach oben gewischt

  const panelOpen = menuSheet.classList.contains('open');
  const startedInLowerHalf = touchStartY > window.innerHeight / 2;

  if (!panelOpen && startedInLowerHalf && dy < -70 && dx < 60) {
    openPinGate();
  } else if (panelOpen && dy > 70 && dx < 60) {
    closeArchive();
  }
  touchStartX = null;
  touchStartY = null;
}, { passive: true });
