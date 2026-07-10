// --- Google Drive Anbindung ---
// Schreibt Notizen als Markdown-Datei in einen einmalig ausgewählten Inbox-Ordner.
// Zugriff ist über den Scope "drive.file" auf genau diesen Ordner beschränkt.

const INBOX_FOLDER_KEY = 'denkarium_inbox_folder_id';

let driveAccessToken = null;
let driveTokenExpiry = 0;
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
      if (response.error) { reject(response); return; }
      driveAccessToken = response.access_token;
      driveTokenExpiry = Date.now() + (response.expires_in - 60) * 1000;
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
      .setTitle('Denkarium-Inbox-Ordner auswählen')
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

async function ensureInboxFolder(forcePick) {
  let folderId = forcePick ? null : localStorage.getItem(INBOX_FOLDER_KEY);
  if (folderId) return folderId;
  const token = await ensureAccessToken();
  folderId = await pickInboxFolder(token);
  localStorage.setItem(INBOX_FOLDER_KEY, folderId);
  return folderId;
}

function buildMarkdownFilename(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_`
    + `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.md`;
}

async function saveNoteToDrive(text) {
  const token = await ensureAccessToken();
  const folderId = await ensureInboxFolder(false);

  const metadata = {
    name: buildMarkdownFilename(new Date()),
    parents: [folderId],
    mimeType: 'text/markdown',
  };
  const boundary = 'denkarium-boundary';
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n${text}\r\n`
    + `--${boundary}--`;

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

async function uploadFileToDrive(file) {
  const token = await ensureAccessToken();
  const folderId = await ensureInboxFolder(false);

  const metadata = {
    name: file.name,
    parents: [folderId],
    mimeType: file.type || 'application/octet-stream',
  };
  const boundary = 'denkarium-boundary-file';
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
