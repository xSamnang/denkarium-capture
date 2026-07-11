// --- Google Drive Anbindung ---
// Schreibt Notizen als Markdown-Dateien in den Drive-Ordner des aktiven
// Projekts (siehe projects.js). Zugriff ist über den Scope "drive.file"
// auf die von der App selbst gewählten Ordner/Dateien beschränkt.

const TOKEN_STORAGE_KEY = 'denkarium_google_token';

// Zugriffstoken über Seiten-Neuladen hinweg merken (localStorage), damit man
// sich nicht bei jedem App-Start/jeder Notiz neu anmelden muss - gilt bis
// zum Ablauf des Tokens (~55 Minuten nach der letzten Anmeldung).
function loadStoredToken() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return { token: null, expiry: 0 };
    const parsed = JSON.parse(raw);
    return { token: parsed.token || null, expiry: parsed.expiry || 0 };
  } catch (e) {
    return { token: null, expiry: 0 };
  }
}

function storeToken(token, expiry) {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiry }));
}

const storedToken = loadStoredToken();
let driveAccessToken = storedToken.token;
let driveTokenExpiry = storedToken.expiry;
let tokenClient = null;
let pickerApiLoaded = false;

// wird per onload-Attribut vom <script src=".../api.js"> aufgerufen
function gapiLoaded() {
  gapi.load('picker', () => { pickerApiLoaded = true; });
}

function getTokenClient() {
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: () => {}, // wird pro Anfrage unten ersetzt
    });
  }
  return tokenClient;
}

function requestAccessToken(interactive) {
  return new Promise((resolve, reject) => {
    const client = getTokenClient();
    client.callback = (response) => {
      if (response.error) {
        // Client verwerfen, damit der nächste Versuch garantiert mit einem
        // frischen, unbelasteten Client startet (statt evtl. hängenzubleiben,
        // nachdem der Nutzer die Anmeldung abgebrochen hat).
        tokenClient = null;
        reject(response);
        return;
      }
      driveAccessToken = response.access_token;
      driveTokenExpiry = Date.now() + (response.expires_in - 60) * 1000;
      storeToken(driveAccessToken, driveTokenExpiry);
      resolve(driveAccessToken);
    };
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

const GOOGLE_GRANTED_KEY = 'denkarium_google_granted';

async function ensureAccessToken() {
  if (driveAccessToken && Date.now() < driveTokenExpiry) return driveAccessToken;

  // Nur nach einer bereits einmal erteilten Erlaubnis leise (ohne Popup)
  // versuchen zu erneuern - sonst direkt mit Popup anfragen, damit der
  // Klick-Bezug für den Popup-Blocker erhalten bleibt.
  if (localStorage.getItem(GOOGLE_GRANTED_KEY)) {
    try {
      return await requestAccessToken(false);
    } catch (e) {
      // leiser Versuch gescheitert (z. B. Sitzung abgelaufen) - mit Popup erneut versuchen
    }
  }

  const token = await requestAccessToken(true);
  localStorage.setItem(GOOGLE_GRANTED_KEY, '1');
  return token;
}

function pickInboxFolder(accessToken) {
  return new Promise((resolve, reject) => {
    if (!pickerApiLoaded) { reject(new Error('Ordner-Auswahl ist noch nicht bereit, bitte kurz erneut versuchen')); return; }
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true);
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setTitle('Drive-Ordner für dieses Projekt auswählen')
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve(data.docs[0].id);
        } else if (data.action === google.picker.Action.CANCEL) {
          reject(new Error('Auswahl abgebrochen'));
        }
      })
      .build();
    picker.setVisible(true);
  });
}

// Zielordner des aktiven Projekts - fragt bei Bedarf einmalig per Picker nach
// und merkt sich die Auswahl im Projekt (siehe projects.js).
async function ensureProjectFolder() {
  const project = getActiveProject();
  if (project.folderId) return project.folderId;
  const token = await ensureAccessToken();
  const folderId = await pickInboxFolder(token);
  setProjectFolder(project.id, folderId);
  return folderId;
}

function buildDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// findet für <dateStr>_1, <dateStr>_2, ... die nächste freie fortlaufende Nummer
async function getNextSequenceNumber(token, folderId, dateStr) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and name contains '${dateStr}_'`);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(name)&pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive-Fehler ${response.status}: ${errText}`);
  }
  const data = await response.json();
  const pattern = new RegExp(`^${dateStr}_(\\d+)`);
  let max = 0;
  (data.files || []).forEach((f) => {
    const m = f.name.match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max + 1;
}

async function uploadMarkdownFile(token, folderId, filename, text) {
  const metadata = { name: filename, parents: [folderId], mimeType: 'text/markdown' };
  // zufällige Grenzmarke, damit Notiztext den Multipart-Aufbau nie stören kann
  const boundary = 'denkarium-' + crypto.getRandomValues(new Uint32Array(2)).join('');
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n`
    + `--${boundary}--`;

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive-Fehler ${response.status}: ${errText}`);
  }
  return response.json();
}

async function saveNoteToDrive(text) {
  const token = await ensureAccessToken();
  const folderId = await ensureProjectFolder();
  const dateStr = buildDateString(new Date());
  const seq = await getNextSequenceNumber(token, folderId, dateStr);
  const filename = `${dateStr}_${seq}.md`;
  return uploadMarkdownFile(token, folderId, filename, text);
}

async function saveEditedVersion(originalName, text) {
  const token = await ensureAccessToken();
  const folderId = await ensureProjectFolder();
  const baseName = originalName.replace(/\.md$/, '');
  const filename = `${baseName}2.0.md`;
  return uploadMarkdownFile(token, folderId, filename, text);
}

async function uploadFileToDrive(file) {
  const token = await ensureAccessToken();
  const folderId = await ensureProjectFolder();

  const metadata = {
    name: file.name,
    parents: [folderId],
    mimeType: file.type || 'application/octet-stream',
  };
  const boundary = 'denkarium-' + crypto.getRandomValues(new Uint32Array(2)).join('');
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  // als Blob zusammensetzen statt als String, damit Bild-/Dateibytes nicht beschädigt werden
  const body = new Blob([metadataPart, fileHeader, file, closing]);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive-Fehler ${response.status}: ${errText}`);
  }
  return response.json();
}
