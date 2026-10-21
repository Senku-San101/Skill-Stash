const $ = id => document.getElementById(id);
let skills = [];
let statusTimer;
let modalResolve = null;
let modalMode = 'details';
let dialogCtx = { existing: [], excludeId: null, editing: false };

// ── Status line (replaces browser alerts) ───────────────────────
function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.className = isError ? 'error' : 'ok';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
function storedSize(f) {
  return f.encoding === 'utf8' ? new Blob([f.content]).size : Math.round(f.content.length * 3 / 4);
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── In-page dialogs (replace confirm / prompt) ──────────────────
function openDialog() { $('modal').classList.remove('hidden'); }

function closeDialog(result) {
  $('modal').classList.add('hidden');
  const resolve = modalResolve;
  modalResolve = null;
  if (resolve) resolve(result);
}

function setDialogRows({ name = true, cmd = false, desc = true, split = false }) {
  $('m-name-row').hidden = !name;
  $('m-cmd-row').hidden = !cmd;
  $('m-desc-row').hidden = !desc;
  $('m-split-row').hidden = !split;
}

// Asks for a skill's details. Resolves to {name, description, command, split} or null.
function askDetails({ title, message, name = '', description = '', command = '',
  showCommand = true, splitOption = false, existing = skills, excludeId = null, editing = false }) {
  modalMode = 'details';
  dialogCtx = { existing, excludeId, editing };
  $('m-title').textContent = title;
  $('m-msg').textContent = message;
  $('m-name').value = name;
  $('m-cmd').value = command;
  $('m-desc').value = description;
  $('m-split').checked = false;
  setDialogRows({ name: true, cmd: showCommand, desc: true, split: splitOption });
  $('m-error').textContent = '';
  $('m-ok').textContent = editing ? 'Save changes' : 'Save';
  $('m-ok').className = 'primary';
  openDialog();
  setTimeout(() => { $('m-name').focus(); $('m-name').select(); }, 0);
  return new Promise(resolve => { modalResolve = resolve; });
}

// Asks yes/no. Resolves to true or false.
function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
  modalMode = 'confirm';
  $('m-title').textContent = title;
  $('m-msg').textContent = message;
  setDialogRows({ name: false, cmd: false, desc: false, split: false });
  $('m-error').textContent = '';
  $('m-ok').textContent = okLabel;
  $('m-ok').className = danger ? 'primary danger' : 'primary';
  openDialog();
  setTimeout(() => $('m-ok').focus(), 0);
  return new Promise(resolve => { modalResolve = resolve; });
}

function dialogError(msg, focusEl) {
  $('m-error').textContent = msg;
  if (focusEl) focusEl.focus();
}

function dialogOk() {
  if (modalMode === 'confirm') return closeDialog(true);

  const name = $('m-name').value.trim();
  if (!name) return dialogError('Give the skill a name.', $('m-name'));

  const raw = $('m-cmd').value.trim();
  const command = SkillStash.cleanCommand(raw);
  if (raw && !command) return dialogError('Commands use letters, numbers, - or _ only.', $('m-cmd'));

  if (command) {
    const owner = dialogCtx.existing.find(s =>
      s.command === command && s.id !== dialogCtx.excludeId && s.name.toLowerCase() !== name.toLowerCase());
    if (owner) return dialogError(`/${command} is already used by "${owner.name}".`, $('m-cmd'));
  }

  if (dialogCtx.editing) {
    const dup = dialogCtx.existing.find(s =>
      s.name.toLowerCase() === name.toLowerCase() && s.id !== dialogCtx.excludeId);
    if (dup) return dialogError(`A skill named "${dup.name}" already exists.`, $('m-name'));
  }

  closeDialog({
    name,
    description: $('m-desc').value.trim(),
    command,
    split: $('m-split').checked
  });
}

function dialogCancel() {
  closeDialog(modalMode === 'confirm' ? false : null);
}

$('m-ok').addEventListener('click', dialogOk);
$('m-cancel').addEventListener('click', dialogCancel);
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') dialogCancel(); });
document.addEventListener('keydown', e => {
  if ($('modal').classList.contains('hidden')) return;
  if (e.key === 'Escape') { e.preventDefault(); dialogCancel(); }
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    dialogOk();
  }
});

// ── Helpers ──────────────────────────────────────────────────────
const isMd = f => /\.(md|markdown|txt)$/i.test(f.name);
const isSkillMd = f => /^skill\.md$/i.test(f.name);
const baseName = n => n.replace(/\.[^.]+$/, '');

function visibleEntries(list) {
  return list.filter(f => !f.webkitRelativePath.split('/').some(p => p.startsWith('.')));
}

// Reads each File and keeps its name (made unique within the skill).
async function storeFiles(list) {
  const used = new Set();
  const out = [];
  for (const f of list) {
    out.push({ name: SkillStash.uniqueName(f.name, used), ...(await SkillStash.readAsStored(f)) });
  }
  return out;
}

async function saveSkills(newSkills, label) {
  const current = await SkillStash.getSkills();
  let replaced = 0;
  for (const s of newSkills) {
    if (SkillStash.upsert(current, s) === 'updated') replaced++;
  }
  await SkillStash.setSkills(current);
  skills = current;
  render();
  setStatus(`Saved ${label}.${replaced ? ' Replaced existing skill with the same name.' : ''}`);
}

async function guard(fn) {
  try { await fn(); } catch (err) { setStatus(`Failed: ${err.message || err}`, true); }
}

// ── Import: files ────────────────────────────────────────────────
async function makeSingleSkill(f) {
  const stored = await SkillStash.readAsStored(f);
  let name = baseName(f.name), description = '', command = '';
  if (stored.encoding === 'utf8' && isMd(f)) {
    try {
      const p = SkillStash.parseSkillMarkdown(stored.content, f.name);
      name = p.name;
      description = p.description;
      command = p.command;
    } catch (_) { /* keep filename */ }
  }
  return { name, description, ...(command ? { command } : {}), files: [{ name: f.name, ...stored }] };
}

async function importFiles(files) {
  let suggested = baseName(files[0].name), suggestedDesc = '', suggestedCmd = '';
  if (files.length === 1 && isMd(files[0])) {
    try {
      const p = SkillStash.parseSkillMarkdown(await files[0].text(), files[0].name);
      suggested = p.name;
      suggestedDesc = p.description;
      suggestedCmd = p.command;
    } catch (_) { /* keep filename */ }
  }

  const details = await askDetails({
    title: files.length === 1 ? 'Name this skill' : `Name this skill (${plural(files.length, 'file')})`,
    message: files.length === 1
      ? `From ${files[0].name}`
      : 'These files will be saved together as one skill.',
    name: suggested,
    description: suggestedDesc,
    command: suggestedCmd,
    splitOption: files.length > 1
  });
  if (!details) return;

  if (details.split) {
    const list = [];
    for (const f of files) list.push(await makeSingleSkill(f));
    return saveSkills(list, plural(list.length, 'skill'));
  }

  const stored = await storeFiles(files);
  return saveSkills(
    [{ name: details.name, description: details.description,
       ...(details.command ? { command: details.command } : {}), files: stored }],
    `"${details.name}" with ${plural(stored.length, 'file')}`
  );
}

// ── Import: folder (the whole folder becomes one skill) ─────────
async function importFolder(list) {
  const entries = visibleEntries(list)
    .sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath));
  if (!entries.length) { setStatus('That folder has no readable files.', true); return; }

  const top = entries[0].webkitRelativePath.split('/')[0];
  const main = entries.find(f => isSkillMd(f) && f.webkitRelativePath.split('/').length === 2);
  let suggested = top, suggestedDesc = '', suggestedCmd = '';
  if (main) {
    try {
      const p = SkillStash.parseSkillMarkdown(await main.text(), 'SKILL.md');
      suggested = p.name;
      suggestedDesc = p.description;
      suggestedCmd = p.command;
    } catch (_) { /* keep folder name */ }
  }

  const details = await askDetails({
    title: 'Name this skill',
    message: `${plural(entries.length, 'file')} from "${top}" will be saved together.`,
    name: suggested,
    description: suggestedDesc,
    command: suggestedCmd
  });
  if (!details) return;

  setStatus('Reading files…');
  const stored = await storeFiles(entries);
  stored.sort((a, b) => (isSkillMd(b) ? 1 : 0) - (isSkillMd(a) ? 1 : 0)); // SKILL.md first
  await saveSkills(
    [{ name: details.name, description: details.description,
       ...(details.command ? { command: details.command } : {}), files: stored }],
    `"${details.name}" with ${plural(stored.length, 'file')}`
  );
}

// ── Edit an existing skill's name, description and command ─────
async function editSkill(skill) {
  const details = await askDetails({
    title: 'Edit skill',
    message: `${plural(skill.files.length, 'file')} stay as they are.`,
    name: skill.name,
    description: skill.description || '',
    command: skill.command || '',
    existing: skills,
    excludeId: skill.id,
    editing: true
  });
  if (!details) return;

  skills = skills.map(s => {
    if (s.id !== skill.id) return s;
    const next = { ...s, name: details.name, description: details.description, updatedAt: Date.now() };
    if (details.command) next.command = details.command;
    else delete next.command;
    return next;
  });
  await SkillStash.setSkills(skills);
  render();
  setStatus(`Updated "${details.name}".`);
}

$('btn-files').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) guard(() => importFiles(files));
});

$('btn-folder').addEventListener('click', () => $('folder-input').click());
$('folder-input').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) guard(() => importFolder(files));
});

// ── Render ───────────────────────────────────────────────────────
function card(skill) {
  const el = document.createElement('div');
  el.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'title-wrap';
  if (skill.command) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `/${skill.command}`;
    titleWrap.appendChild(badge);
  }
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = skill.name;
  title.title = skill.name;
  titleWrap.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'actions-row';
  const edit = document.createElement('button');
  edit.className = 'mini';
  edit.textContent = 'Edit';
  edit.addEventListener('click', () => guard(() => editSkill(skill)));
  const del = document.createElement('button');
  del.className = 'mini danger';
  del.textContent = 'Delete';
  del.addEventListener('click', () => guard(() => deleteSkill(skill)));
  actions.append(edit, del);

  head.append(titleWrap, actions);

  const desc = document.createElement('div');
  desc.className = 'card-desc';
  desc.textContent = `${plural(skill.files.length, 'file')}${skill.description ? ' · ' + skill.description : ''}`;

  const ul = document.createElement('ul');
  ul.className = 'files';
  skill.files.forEach(f => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = f.name;
    name.title = f.name;
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.textContent = fmtSize(storedSize(f));
    li.append(name, meta);

    if (f.encoding === 'utf8') {
      const pre = document.createElement('pre');
      pre.className = 'preview';
      pre.hidden = true;
      pre.textContent = f.content;
      const view = document.createElement('button');
      view.className = 'mini';
      view.textContent = 'View';
      view.addEventListener('click', () => {
        pre.hidden = !pre.hidden;
        view.textContent = pre.hidden ? 'View' : 'Hide';
      });
      li.insertBefore(view, meta);
      li.append(pre);
    }
    ul.appendChild(li);
  });

  el.append(head, desc, ul);
  return el;
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const list = $('list');
  $('count').textContent = skills.length ? plural(skills.length, 'skill') + ' saved' : 'No skills yet';
  list.innerHTML = '';

  if (!skills.length) {
    list.innerHTML = '<div class="empty">Click <b>+ Files</b> to add single files, or <b>+ Folder</b> to add a whole skill folder.</div>';
    return;
  }

  const shown = skills.filter(s =>
    !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
      || (s.command || '').includes(q.replace(/^\//, '')));

  if (!shown.length) {
    list.innerHTML = '<div class="empty">No matches.</div>';
    return;
  }
  shown.forEach(s => list.appendChild(card(s)));
}

async function deleteSkill(skill) {
  const ok = await confirmDialog({
    title: 'Delete skill?',
    message: `"${skill.name}" and its ${plural(skill.files.length, 'file')} will be removed.`,
    okLabel: 'Delete',
    danger: true
  });
  if (!ok) return;
  skills = skills.filter(s => s.id !== skill.id);
  await SkillStash.setSkills(skills);
  render();
  setStatus(`Deleted "${skill.name}".`);
}

// ── Settings ─────────────────────────────────────────────────────
function updateTextOnlyVisibility() {
  const textMode = $('paste-mode').value === 'text';
  document.querySelectorAll('.text-only').forEach(el => { el.hidden = !textMode; });
}

$('paste-mode').addEventListener('change', e => {
  chrome.storage.local.set({ pasteMode: e.target.value });
  updateTextOnlyVisibility();
  setStatus('Saved.');
});
$('insert-at').addEventListener('change', e => {
  chrome.storage.local.set({ insertAt: e.target.value });
  setStatus('Saved.');
});
$('search').addEventListener('input', render);

// ── Backup ───────────────────────────────────────────────────────
$('btn-export').addEventListener('click', () => {
  const blob = new Blob(
    [JSON.stringify({ type: 'skill-stash', version: 3, exportedAt: new Date().toISOString(), skills }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `skill-stash-backup-${new Date().toISOString().slice(0, 10)}.json`
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('Backup exported.');
});

$('btn-restore').addEventListener('click', () => $('restore-input').click());
$('restore-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.skills)) throw new Error('not a Skill Stash backup');
    const current = await SkillStash.getSkills();
    let added = 0, updated = 0;
    for (const s of data.skills) {
      if (!s || typeof s.name !== 'string') continue;
      const { files } = SkillStash.normalize(s);
      if (!files.length) continue;
      const command = SkillStash.cleanCommand(s.command || '');
      const r = SkillStash.upsert(current, {
        name: s.name,
        description: typeof s.description === 'string' ? s.description : '',
        ...(command ? { command } : {}),
        files
      });
      r === 'added' ? added++ : updated++;
    }
    await SkillStash.setSkills(current);
    skills = current;
    render();
    setStatus(`Restored: ${added} added, ${updated} updated.`);
  } catch (err) {
    setStatus(`Restore failed: ${err.message}`, true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.skills) {
    skills = (changes.skills.newValue || []).map(SkillStash.normalize);
    render();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await SkillStash.getSettings();
  $('paste-mode').value = settings.pasteMode;
  $('insert-at').value = settings.insertAt;
  updateTextOnlyVisibility();
  skills = await SkillStash.getSkills();
  render();
});


// ── Credits and update check ────────────────────────────────────
async function showUpdateStatus(force = false) {
  const line = $('update-line');
  const banner = $('update-banner');
  const btn = $('btn-update');
  btn.disabled = true;
  line.textContent = 'Checking for updates…';
  const info = await SkillStashUpdates.check({ force });
  btn.disabled = false;
  banner.hidden = true;

  if (info.status === 'not-configured') {
    line.textContent = `Version ${info.current}. Update checks are not set up yet.`;
    return;
  }
  if (info.status === 'error') {
    line.textContent = `Version ${info.current}. Could not check for updates (${info.message}).`;
    return;
  }
  if (info.status === 'current') {
    line.textContent = `Version ${info.current}. You have the latest version.`;
    return;
  }

  // update available
  line.textContent = `Version ${info.latest} is available. You have ${info.current}.`;
  const { dismissedVersion } = await chrome.storage.local.get('dismissedVersion');
  if (dismissedVersion === info.latest) return;
  $('update-text').textContent = `Skill Stash ${info.latest} is available.`;
  $('update-link').href = info.url;
  banner.hidden = false;
}

$('update-dismiss').addEventListener('click', async () => {
  const info = await SkillStashUpdates.check();
  if (info.latest) await chrome.storage.local.set({ dismissedVersion: info.latest });
  $('update-banner').hidden = true;
});
$('btn-update').addEventListener('click', () => showUpdateStatus(true));

(function fillCredits() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  $('lnk-issues').href = SkillStashUpdates.issuesUrl();
})();

document.addEventListener('DOMContentLoaded', () => showUpdateStatus(false));
