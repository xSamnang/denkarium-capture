// --- Aufnahme-Button: Druck-Feedback + lautstärke-reaktiver Lichtring ---
const recordButton = document.getElementById('recordButton');
const lensHalo = document.getElementById('lensHalo');
const liveCaption = document.getElementById('liveCaption');
const cancelTrash = document.getElementById('cancelTrash');
const cancelTrashLabel = document.getElementById('cancelTrashLabel');
const lockIndicator = document.getElementById('lockIndicator');
const baseRingDuration = 3.5;
const CANCEL_HINT_LABEL = 'Ziehen zum Abbrechen';
const CANCEL_ARMED_LABEL = 'Loslassen zum Abbrechen';
const CANCEL_COMMIT_PX = 100; // Wegstrecke, ab der Loslassen abbricht - bewusst kurz & großzügig

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
let recognitionErrorMessage = null;

if (SpeechRecognitionImpl) {
  recognition = new SpeechRecognitionImpl();
  recognition.lang = 'de-DE';
  // continuous:true ist auf Android/Chrome Mobile stark fehlerhaft - der Dienst
  // wiederholt dort intern dieselbe erkannte Phrase mehrfach als eigenes
  // finales Ergebnis ("projekt projekt projekt ..."). Wir lassen jede Erkennung
  // nach einer Sprechpause regulär enden und starten sie über das 'end'-Event
  // unten selbst sofort neu - das ergibt effektiv durchgehende Diktierfunktion,
  // ohne den kaputten nativen Dauerbetrieb zu nutzen.
  recognition.continuous = false;
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

  // Fehler, die sich durch einen Neustart nicht von selbst lösen - dauerhaftes
  // erneutes Versuchen würde nur eine Endlosschleife aus Fehlversuchen erzeugen
  const FATAL_RECOGNITION_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

  recognition.addEventListener('error', (event) => {
    console.warn('Spracherkennung-Fehler:', event.error);
    if (FATAL_RECOGNITION_ERRORS.has(event.error)) {
      recognitionShouldRun = false; // nicht automatisch neu versuchen
    }
    const messages = {
      'not-allowed': 'Mikrofon-Zugriff für Spracherkennung verweigert',
      'service-not-allowed': 'Mikrofon-Zugriff für Spracherkennung verweigert',
      'audio-capture': 'Kein Mikrofon gefunden',
      'network': 'Keine Verbindung zum Spracherkennungs-Dienst (Internet prüfen)',
      'no-speech': 'Keine Sprache erkannt – bitte näher am Mikrofon sprechen',
      'language-not-supported': 'Sprache "Deutsch" wird nicht unterstützt',
    };
    // 'aborted' passiert normal, wenn wir selbst stop() aufrufen - keine Meldung nötig
    if (event.error === 'aborted') return;
    const message = messages[event.error] || `Spracherkennung-Fehler: ${event.error}`;
    recognitionErrorMessage = message; // merken, damit "Nichts erkannt" das nicht überschreibt
    showToast(message);
  });

  // manche Browser beenden die Erkennung nach kurzer Sprechpause von sich aus -
  // solange noch aufgenommen wird, einfach neu starten. Wurde bewusst gestoppt
  // (Loslassen/Abbrechen) oder trat ein dauerhafter Fehler auf, war das der
  // Startschuss, um den finalen Text zu übernehmen - das letzte Ergebnis kommt
  // sonst erst nach dem Loslassen an.
  recognition.addEventListener('end', () => {
    if (recognitionShouldRun) {
      try { recognition.start(); } catch (e) { /* already running */ }
      return;
    }
    if (pendingStopAction) finishPendingStop();
  });
}

let pendingStopAction = null; // 'review' | 'cancel' | null
let stopFallbackTimer = null;

async function finishPendingStop() {
  const action = pendingStopAction;
  pendingStopAction = null;
  if (stopFallbackTimer) { clearTimeout(stopFallbackTimer); stopFallbackTimer = null; }
  if (action === 'review') {
    const text = finalTranscript.trim();
    if (text) {
      await saveTranscriptDirectly(text);
    } else if (!recognitionErrorMessage) {
      // nur zeigen, wenn kein spezifischerer Fehler (Mikrofon/Netzwerk/...)
      // bereits erklärt hat, warum nichts ankam - sonst würde diese
      // generische Meldung die hilfreichere überschreiben
      showToast('Nichts erkannt – bitte erneut versuchen');
    }
  } else if (action === 'cancel') {
    finalTranscript = '';
    showToast('Aufnahme verworfen');
  }
}

async function saveTranscriptDirectly(text) {
  showToast('Speichere in Google Drive …');
  try {
    const result = await saveNoteToDrive(text);
    addRecentEntry({ id: result.id, name: result.name, text, createdAt: Date.now() });
    showToast('In Google Drive gespeichert');
  } catch (err) {
    console.error('Speichern in Drive fehlgeschlagen:', err);
    if (err && (err.error === 'access_denied' || err.error === 'popup_closed_by_user')) {
      showToast('Google-Anmeldung abgebrochen – Text bitte hier erneut speichern');
    } else {
      showToast('Anmeldung nötig oder Fehler – Text bitte hier erneut speichern');
    }
    // Text nicht verwerfen: Notizfeld mit dem gesprochenen Text
    // vorausfüllen, damit ein Anmelde-Problem nicht auch noch die Aufnahme
    // kostet. Der "Speichern"-Tipp dort ist außerdem ein echter Klick, mit
    // dem eine evtl. nötige Google-Anmeldung zuverlässig funktioniert -
    // anders als ein automatischer Versuch tief in dieser asynchronen Kette.
    openTextEntry(text);
  }
}

function applyVolume(volume01) {
  const clamped = Math.max(0, Math.min(1, volume01));
  const factor = Math.max(0.12, 1 - clamped * 0.88);
  lensHalo.style.animationDuration = (baseRingDuration * factor) + 's';
  lensHalo.style.opacity = (0.85 + clamped * 0.15).toFixed(2);

  if (recording) {
    recordButton.style.transform = `scale(${1 + clamped * 0.22})`;
    // weiche Aura in der Ringfarbe, die mit der Stimme atmet
    const glowSize = Math.round(24 + clamped * 60);
    const glowSpread = Math.round(6 + clamped * 26);
    const glowMix = Math.round(14 + clamped * 26);
    recordButton.style.boxShadow =
      `0 0 ${glowSize}px ${glowSpread}px color-mix(in srgb, var(--ring-color) ${glowMix}%, transparent)`;
  }
}

function idleLoop(t) {
  // sobald aufgenommen wird, übernehmen recordingTick/fakeRecordingTick die
  // Schleife - hier NICHT weiter neu anstoßen, sonst laufen zwei rAF-Ketten
  // parallel und überschreiben sich gegenseitig die gemeinsame rafId
  if (recording) return;
  const breathing = (Math.sin(t / 1800) * 0.5 + 0.5) * 0.1;
  applyVolume(breathing);
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

// läuft, wenn kein echtes Mikrofon-Level verfügbar ist (z. B. Zugriff
// verweigert) - simuliert eine lebendige Bewegung, damit der Button trotzdem
// sichtbar "lebt", statt während der Aufnahme regungslos dazustehen
function fakeRecordingTick(t) {
  if (!recording) return;
  const wave = (Math.sin(t / 260) * 0.5 + 0.5) * 0.55 + Math.random() * 0.2;
  applyVolume(Math.min(1, wave));
  rafId = requestAnimationFrame(fakeRecordingTick);
}

async function startRecording() {
  recordButton.classList.add('recording');
  recording = true;

  finalTranscript = '';
  recognitionErrorMessage = null;
  liveCaption.textContent = '';
  liveCaption.hidden = false;
  if (recognition) {
    // Spracherkennung ist der Kern - sie greift selbst aufs Mikrofon zu.
    // Wir öffnen NICHT zusätzlich getUserMedia für die Lautstärke-Animation:
    // auf vielen Handys bringt ein zweiter, paralleler Mikrofon-Zugriff die
    // Spracherkennung zum Schweigen. Die lebendige Bewegung übernimmt
    // stattdessen die simulierte Animation.
    recognitionShouldRun = true;
    try {
      recognition.start();
    } catch (e) {
      if (e.name !== 'InvalidStateError') {
        console.warn('Spracherkennung konnte nicht gestartet werden:', e);
        showToast('Spracherkennung konnte nicht gestartet werden');
      }
    }
    cancelAnimationFrame(rafId);
    fakeRecordingTick(performance.now());
    return;
  }

  // Kein SpeechRecognition verfügbar: dann wenigstens die Lautstärke live
  // anzeigen (Diktat ist ohnehin nicht möglich, Text muss getippt werden).
  liveCaption.textContent = 'Spracherkennung wird von diesem Browser nicht unterstützt – Text manuell eingeben.';
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
    cancelAnimationFrame(rafId);
    fakeRecordingTick(performance.now());
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
  cancelTrash.style.transform = '';
  cancelTrashLabel.textContent = CANCEL_HINT_LABEL;
  lockIndicator.hidden = true;
  pendingCancel = false;

  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  cancelAnimationFrame(rafId);
  idleLoop(performance.now());
}

// Beendet die Spracherkennung und wartet auf ihr tatsächliches 'end'-Ereignis,
// bevor die Folgeaktion (automatisch speichern / verwerfen) ausgeführt wird -
// sonst fehlt oft der zuletzt gesprochene Satz, der erst nach recognition.stop()
// final ankommt.
function stopSpeechAndRun(action) {
  if (recognition && recognitionShouldRun) {
    pendingStopAction = action;
    recognitionShouldRun = false;
    clearTimeout(stopFallbackTimer);
    stopFallbackTimer = setTimeout(finishPendingStop, 1200);
    try { recognition.stop(); } catch (e) { finishPendingStop(); }
  } else {
    pendingStopAction = action;
    finishPendingStop();
  }
}

function stopRecording() {
  stopRecordingInternals();
  stopSpeechAndRun('review');
}

function cancelRecording() {
  stopRecordingInternals();
  stopSpeechAndRun('cancel');
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

  // zur Seite ziehen (links ODER rechts) -> Abbrechen, sobald losgelassen.
  // Der Hinweis folgt gedämpft dem Finger statt an einem festen, weit
  // entfernten Punkt zu kleben - so reicht eine kurze, bequeme Bewegung in
  // die Richtung, die gerade angenehm ist.
  if (Math.abs(dx) > Math.abs(dy)) {
    const followX = Math.max(-70, Math.min(70, dx * 0.35));
    cancelTrash.style.transform = `translate(calc(-50% + ${followX}px), -50%)`;
    pendingCancel = Math.abs(dx) > CANCEL_COMMIT_PX;
    cancelTrash.classList.toggle('armed', pendingCancel);
    cancelTrashLabel.textContent = pendingCancel ? CANCEL_ARMED_LABEL : CANCEL_HINT_LABEL;
  } else {
    pendingCancel = false;
    cancelTrash.classList.remove('armed');
    cancelTrash.style.transform = '';
    cancelTrashLabel.textContent = CANCEL_HINT_LABEL;
  }
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
  cancelTrash.style.transform = '';
  cancelTrashLabel.textContent = CANCEL_HINT_LABEL;
  lockIndicator.hidden = true;

  if (navigator.vibrate && isVibrationEnabled()) navigator.vibrate(15);

  // Google-Zugangstoken schon jetzt auffrischen (nicht abwarten) - im
  // frischen Tipp-Kontext dieses Tastendrucks funktioniert eine evtl.
  // nötige Anmeldung zuverlässig, statt erst Sekunden später beim
  // automatischen Speichern nach der Aufnahme geblockt zu werden.
  prefetchAccessToken();

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

// --- Toast-Hinweis (kurzes Feedback am unteren Bildschirmrand) ---
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

// --- Texteingabe-Overlay (Neue Notiz / Eintrag bearbeiten) ---
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

// --- Plus-Knopf: Schnellmenü (Notiz/Datei), langes Drücken öffnet direkt die Notiz ---
const fabWrap = document.getElementById('fabWrap');
const fabBtn = document.getElementById('fabBtn');
const speedDial = document.getElementById('speedDial');
const dialNote = document.getElementById('dialNote');
const dialFile = document.getElementById('dialFile');
const fileInput = document.getElementById('fileInput');

let dialOpen = false;
let fabPressTimer = null;
let fabLongPressed = false;

function openDial() {
  dialOpen = true;
  speedDial.hidden = false;
  // erst einblenden, dann Klasse setzen, damit die Stagger-Transition greift
  requestAnimationFrame(() => speedDial.classList.add('open'));
  fabBtn.classList.add('open');
  fabBtn.setAttribute('aria-expanded', 'true');
}

function closeDial() {
  if (!dialOpen) return;
  dialOpen = false;
  speedDial.classList.remove('open');
  speedDial.hidden = true;
  fabBtn.classList.remove('open');
  fabBtn.setAttribute('aria-expanded', 'false');
}

fabBtn.addEventListener('pointerdown', () => {
  fabLongPressed = false;
  clearTimeout(fabPressTimer);
  fabPressTimer = setTimeout(() => {
    fabLongPressed = true;
    closeDial();
    if (navigator.vibrate && isVibrationEnabled()) navigator.vibrate(10);
    openTextEntry('');
  }, 450);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) =>
  fabBtn.addEventListener(evt, (e) => {
    clearTimeout(fabPressTimer);
    if (evt === 'pointerup' && !fabLongPressed) {
      dialOpen ? closeDial() : openDial();
    }
  })
);
fabBtn.addEventListener('contextmenu', (e) => e.preventDefault());

dialNote.addEventListener('click', () => { closeDial(); openTextEntry(''); });
dialFile.addEventListener('click', () => { closeDial(); fileInput.click(); });

document.addEventListener('click', (e) => {
  if (dialOpen && !fabWrap.contains(e.target)) closeDial();
});

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

// "Letzte Einträge" ist der einzige PIN-geschützte Bereich - einmal
// entsperrt bleibt er für die laufende Sitzung offen.
let recentUnlocked = false;

function openMenu() {
  menuSheet.classList.add('open');
  menuBackdrop.classList.add('open');
  menuSheet.setAttribute('aria-hidden', 'false');
}
function closeMenu() {
  menuSheet.classList.remove('open');
  menuBackdrop.classList.remove('open');
  menuSheet.setAttribute('aria-hidden', 'true');
}

// wird auch von projects.js ("Projekte verwalten …") aufgerufen
function openMenuAtSettings() {
  activateTab('settings');
  openMenu();
}

function activateTab(target) {
  menuTabs.querySelectorAll('.menu-tab').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.tab === target)
  );
  menuSheet.querySelectorAll('.menu-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== target;
  });
}

menuClose.addEventListener('click', closeMenu);
menuBackdrop.addEventListener('click', closeMenu);

// Tab wählen - "Letzte Einträge" verlangt einmal pro Sitzung die PIN.
function selectTab(target) {
  if (target === 'recent' && !recentUnlocked) {
    requestPinUnlock(() => {
      recentUnlocked = true;
      activateTab('recent');
    });
    return;
  }
  activateTab(target);
}

menuTabs.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.menu-tab');
  if (!tabBtn) return;
  selectTab(tabBtn.dataset.tab);
});

// Links/rechts wischen wechselt zwischen den Tabs.
const TAB_ORDER = ['settings', 'recent', 'guide'];
function currentTabIndex() {
  const active = menuTabs.querySelector('.menu-tab.active');
  return active ? TAB_ORDER.indexOf(active.dataset.tab) : 0;
}
function stepTab(direction) {
  const next = currentTabIndex() + direction;
  if (next < 0 || next >= TAB_ORDER.length) return;
  selectTab(TAB_ORDER[next]);
}

let menuSwipeX = null;
let menuSwipeY = null;
let menuSwipeIgnore = false;
menuSheet.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  menuSwipeX = t.clientX;
  menuSwipeY = t.clientY;
  // Wischen, das auf dem Farbrad beginnt, gehört der Farbauswahl
  menuSwipeIgnore = !!e.target.closest('.color-wheel');
}, { passive: true });
menuSheet.addEventListener('touchend', (e) => {
  if (menuSwipeX === null || menuSwipeIgnore) { menuSwipeX = null; return; }
  const t = e.changedTouches[0];
  const dx = t.clientX - menuSwipeX;
  const dy = t.clientY - menuSwipeY;
  // klar horizontale Geste (nicht mit Scrollen/Schließen verwechseln)
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) {
    stepTab(dx < 0 ? 1 : -1); // nach links wischen = nächster Tab
  }
  menuSwipeX = null;
  menuSwipeY = null;
}, { passive: true });

// --- PIN-Schutz (nur für "Letzte Einträge") ---
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
let pinOnSuccess = null;

async function sha256(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderPinDots() {
  [...pinDots.children].forEach((dot, i) => dot.classList.toggle('filled', i < pinEntered.length));
}

function startPinFlow(mode, title, onSuccess) {
  pinEntered = '';
  pinFirstEntry = '';
  pinError.textContent = '';
  pinMode = mode;
  pinTitle.textContent = title;
  pinOnSuccess = onSuccess;
  renderPinDots();
  pinGate.hidden = false;
}

// Entsperren: fragt die bestehende PIN ab; gibt es noch keine,
// wird sie zuerst festgelegt (mit Bestätigung).
function requestPinUnlock(onSuccess) {
  const hasPin = !!localStorage.getItem(PIN_STORAGE_KEY);
  if (hasPin) {
    startPinFlow('verify', 'PIN eingeben', onSuccess);
  } else {
    startPinFlow('set', 'Neue PIN festlegen', onSuccess);
  }
}

// PIN ändern (Einstellungen -> Sicherheit): erst alte bestätigen, dann neue setzen
function requestPinChange() {
  const hasPin = !!localStorage.getItem(PIN_STORAGE_KEY);
  if (!hasPin) {
    startPinFlow('set', 'Neue PIN festlegen', () => showToast('PIN festgelegt'));
    return;
  }
  startPinFlow('verify', 'Aktuelle PIN eingeben', () => {
    startPinFlow('set', 'Neue PIN festlegen', () => showToast('PIN geändert'));
  });
}

function closePinGate() {
  pinGate.hidden = true;
  pinEntered = '';
  pinOnSuccess = null;
}

function finishPinSuccess() {
  const cb = pinOnSuccess;
  pinGate.hidden = true;
  pinEntered = '';
  pinOnSuccess = null;
  if (cb) cb();
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
    finishPinSuccess();
    return;
  }

  // mode 'verify'
  const hash = await sha256(pinEntered);
  if (hash === localStorage.getItem(PIN_STORAGE_KEY)) {
    finishPinSuccess();
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

document.getElementById('changePinBtn').addEventListener('click', requestPinChange);

// --- Hilfe-Center: FAQ nach Frage/Antwort durchsuchen ---
const helpSearch = document.getElementById('helpSearch');
const helpEmpty = document.getElementById('helpEmpty');

if (helpSearch) {
  helpSearch.addEventListener('input', () => {
    const query = helpSearch.value.trim().toLowerCase();
    let anyVisible = false;

    document.querySelectorAll('.help-group').forEach((group) => {
      let groupHasMatch = false;
      group.querySelectorAll('.faq').forEach((faq) => {
        const text = faq.textContent.toLowerCase();
        const match = query === '' || text.includes(query);
        faq.hidden = !match;
        if (match) groupHasMatch = true;
        // beim Filtern automatisch aufklappen, damit die Antwort sichtbar wird
        if (query !== '' && match) faq.open = true;
        else if (query === '') faq.open = false;
      });
      group.hidden = !groupHasMatch;
      if (groupHasMatch) anyVisible = true;
    });

    helpEmpty.hidden = anyVisible;
  });
}

// --- Feedback & Info ---
const APP_VERSION = '1.0 (Build v7)';
const FEEDBACK_EMAIL = 'ajunge.business@gmail.com';

const appVersionEl = document.getElementById('appVersion');
if (appVersionEl) appVersionEl.textContent = `Denkarium Capture · Version ${APP_VERSION}`;

function openFeedbackMail(kind) {
  const subject = kind === 'bug'
    ? '[Denkarium Capture] Fehler melden'
    : '[Denkarium Capture] Verbesserungsvorschlag';
  const intro = kind === 'bug'
    ? 'Was ist passiert? Was hattest du erwartet?'
    : 'Deine Idee oder dein Wunsch:';
  const body = [
    intro,
    '',
    '',
    '— Technische Infos (helfen bei der Fehlersuche, dürfen bleiben) —',
    `Version: ${APP_VERSION}`,
    `Gerät/Browser: ${navigator.userAgent}`,
    `Sprache: ${navigator.language}`,
  ].join('\n');
  window.location.href =
    `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

document.getElementById('reportBugBtn').addEventListener('click', () => openFeedbackMail('bug'));
document.getElementById('suggestBtn').addEventListener('click', () => openFeedbackMail('idea'));

// "Datenschutz & Sicherheit" springt ins Hilfe-Center zum Sicherheits-Bereich
document.getElementById('privacyBtn').addEventListener('click', () => {
  selectTab('guide');
  const group = document.querySelector('.help-group[data-group="Sicherheit"]');
  if (group) {
    group.querySelectorAll('.faq').forEach((f) => { f.hidden = false; });
    requestAnimationFrame(() => group.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
});

// --- Zen-Modus: Tipp auf den freien Hintergrund blendet die Bedienelemente aus ---
const stageArea = document.querySelector('.stage');
stageArea.addEventListener('click', (e) => {
  if (e.target !== stageArea) return;          // nur echter Hintergrund, nicht der Kreis
  if (recording || locked) return;             // während einer Aufnahme nichts verstecken
  if (menuSheet.classList.contains('open')) return;
  if (dialOpen) { closeDial(); return; }       // offenes Schnellmenü zuerst schließen
  document.body.classList.toggle('zen');
});

// --- Wisch-Gesten: hoch = Menü öffnen, runter = schließen ---
let touchStartX = null;
let touchStartY = null;
let touchStartedInPanel = false;

document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  // Wischen innerhalb der scrollbaren Liste (Einstellungen/Einträge/Hilfe)
  // darf nur scrollen - nicht das Menü schließen. Zum Schließen per Wisch
  // bleiben Griff und Tableiste (außerhalb von .menu-panel) zuständig.
  touchStartedInPanel = !!e.target.closest('.menu-panel');
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const t = e.changedTouches[0];
  const dx = Math.abs(t.clientX - touchStartX);
  const dy = t.clientY - touchStartY; // negativ = nach oben gewischt

  const panelOpen = menuSheet.classList.contains('open');
  const startedInLowerHalf = touchStartY > window.innerHeight / 2;

  if (!panelOpen && startedInLowerHalf && dy < -70 && dx < 60) {
    openMenu();
  } else if (panelOpen && !touchStartedInPanel && dy > 70 && dx < 60) {
    closeMenu();
  }
  touchStartX = null;
  touchStartY = null;
}, { passive: true });
