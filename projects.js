// --- Projekte: jedes Projekt speichert in seinen eigenen Drive-Ordner ---
// Der Umschalter oben wechselt das aktive Projekt; verwaltet wird in den
// Einstellungen. Ein bereits gewählter Inbox-Ordner aus früheren Versionen
// wird automatisch als Standard-Projekt "Inbox" übernommen.

const PROJECTS_KEY = 'denkarium_projects';
const ACTIVE_PROJECT_KEY = 'denkarium_active_project';

function newProjectId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadProjects() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY));
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((p) => p && p.id && p.name)) {
      return parsed;
    }
  } catch (e) { /* beschädigt - neu aufbauen */ }
  // Migration: bisherigen Inbox-Ordner (falls vorhanden) übernehmen
  const legacyFolder = localStorage.getItem('denkarium_inbox_folder_id') || null;
  return [{ id: newProjectId(), name: 'Inbox', folderId: legacyFolder }];
}

let projects = loadProjects();
let activeProjectId = localStorage.getItem(ACTIVE_PROJECT_KEY);
if (!projects.some((p) => p.id === activeProjectId)) {
  activeProjectId = projects[0].id;
}

function saveProjects() {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
}
saveProjects();

function getActiveProject() {
  return projects.find((p) => p.id === activeProjectId) || projects[0];
}

function setProjectFolder(projectId, folderId) {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return;
  project.folderId = folderId;
  saveProjects();
  renderProjectUI();
}

/* ---------- UI: Pill oben + Dropdown ---------- */

const projectPill = document.getElementById('projectPill');
const projectPillName = document.getElementById('projectPillName');
const projectMenu = document.getElementById('projectMenu');
const projectListEl = document.getElementById('projectList');
const addProjectBtn = document.getElementById('addProjectBtn');

function closeProjectMenu() {
  projectMenu.hidden = true;
  projectPill.setAttribute('aria-expanded', 'false');
}

function renderProjectMenu() {
  projectMenu.textContent = '';
  projects.forEach((project) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'project-menu__item' + (project.id === activeProjectId ? ' active' : '');
    item.setAttribute('role', 'option');

    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('viewBox', '0 0 24 24');
    check.setAttribute('class', 'check');
    check.innerHTML = '<path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';

    const label = document.createElement('span');
    label.textContent = project.name;

    item.appendChild(check);
    item.appendChild(label);
    item.addEventListener('click', () => {
      activeProjectId = project.id;
      saveProjects();
      renderProjectUI();
      closeProjectMenu();
    });
    projectMenu.appendChild(item);
  });

  const divider = document.createElement('div');
  divider.className = 'project-menu__divider';
  projectMenu.appendChild(divider);

  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'project-menu__item project-menu__manage';
  manage.textContent = 'Projekte verwalten …';
  manage.addEventListener('click', () => {
    closeProjectMenu();
    openMenuAtSettings();
  });
  projectMenu.appendChild(manage);
}

projectPill.addEventListener('click', () => {
  if (projectMenu.hidden) {
    renderProjectMenu();
    projectMenu.hidden = false;
    projectPill.setAttribute('aria-expanded', 'true');
  } else {
    closeProjectMenu();
  }
});

document.addEventListener('click', (e) => {
  if (!projectMenu.hidden && !document.getElementById('projectSwitcher').contains(e.target)) {
    closeProjectMenu();
  }
});

/* ---------- UI: Liste in den Einstellungen ---------- */

function projectActionButton(svgPath, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'project-row__action';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
  return btn;
}

function renderProjectList() {
  projectListEl.textContent = '';
  projects.forEach((project) => {
    const row = document.createElement('div');
    row.className = 'project-row' + (project.id === activeProjectId ? ' active' : '');

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'project-row__main';
    const name = document.createElement('span');
    name.className = 'project-row__name';
    name.textContent = project.name;
    const folder = document.createElement('span');
    folder.className = 'project-row__folder';
    folder.textContent = project.folderId ? 'Drive-Ordner verbunden' : 'Noch kein Ordner gewählt';
    main.appendChild(name);
    main.appendChild(folder);
    main.addEventListener('click', () => {
      activeProjectId = project.id;
      saveProjects();
      renderProjectUI();
    });

    const folderBtn = projectActionButton(
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
      'Drive-Ordner wählen'
    );
    folderBtn.addEventListener('click', async () => {
      try {
        const token = await ensureAccessToken();
        const folderId = await pickInboxFolder(token);
        setProjectFolder(project.id, folderId);
        showToast(`Ordner für „${project.name}“ verbunden`);
      } catch (err) {
        showToast('Ordner-Auswahl abgebrochen');
      }
    });

    const renameBtn = projectActionButton(
      '<path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />',
      'Projekt umbenennen'
    );
    renameBtn.addEventListener('click', () => {
      openNameDialog('Projekt umbenennen', project.name, (value) => {
        project.name = value;
        saveProjects();
        renderProjectUI();
      });
    });

    row.appendChild(main);
    row.appendChild(folderBtn);
    row.appendChild(renameBtn);

    if (projects.length > 1) {
      const deleteBtn = projectActionButton(
        '<path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />',
        'Projekt entfernen'
      );
      deleteBtn.addEventListener('click', () => {
        if (!confirm(`Projekt „${project.name}“ entfernen?\n\nDein Google-Drive-Ordner und alle Dateien darin bleiben unberührt.`)) return;
        projects = projects.filter((p) => p.id !== project.id);
        if (activeProjectId === project.id) activeProjectId = projects[0].id;
        saveProjects();
        renderProjectUI();
      });
      row.appendChild(deleteBtn);
    }

    projectListEl.appendChild(row);
  });
}

addProjectBtn.addEventListener('click', () => {
  openNameDialog('Neues Projekt', '', (value) => {
    const project = { id: newProjectId(), name: value, folderId: null };
    projects.push(project);
    activeProjectId = project.id;
    saveProjects();
    renderProjectUI();
    showToast('Projekt angelegt – wähle noch seinen Drive-Ordner');
  });
});

/* ---------- Namens-Dialog (wiederverwendbar) ---------- */

const nameDialog = document.getElementById('nameDialog');
const nameDialogTitle = document.getElementById('nameDialogTitle');
const nameDialogInput = document.getElementById('nameDialogInput');
const nameDialogOk = document.getElementById('nameDialogOk');
const nameDialogCancel = document.getElementById('nameDialogCancel');
let nameDialogCallback = null;

function openNameDialog(title, initialValue, onSubmit) {
  nameDialogTitle.textContent = title;
  nameDialogInput.value = initialValue || '';
  nameDialogCallback = onSubmit;
  nameDialog.hidden = false;
  nameDialogInput.focus();
  nameDialogInput.select();
}

function closeNameDialog() {
  nameDialog.hidden = true;
  nameDialogCallback = null;
}

nameDialogOk.addEventListener('click', () => {
  const value = nameDialogInput.value.trim();
  if (!value) { closeNameDialog(); return; }
  const cb = nameDialogCallback;
  closeNameDialog();
  if (cb) cb(value);
});
nameDialogCancel.addEventListener('click', closeNameDialog);
nameDialogInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') nameDialogOk.click();
  if (e.key === 'Escape') closeNameDialog();
});

/* ---------- gemeinsames Rendering ---------- */

function renderProjectUI() {
  projectPillName.textContent = getActiveProject().name;
  renderProjectList();
  if (!projectMenu.hidden) renderProjectMenu();
}

renderProjectUI();
