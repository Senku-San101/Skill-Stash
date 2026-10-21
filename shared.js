// Shared helpers used by the popup, the manager tab and the in-page content script.
// A skill = { id, name, description, command?, files: [{ name, type, encoding: 'utf8'|'base64', content }] }
const SkillStash = {
  async getSkills() {
    const { skills = [] } = await chrome.storage.local.get('skills');
    return skills.map(SkillStash.normalize);
  },

  async setSkills(skills) {
    await chrome.storage.local.set({ skills });
  },

  async getSettings() {
    const { pasteMode = 'files', insertAt = 'start' } =
      await chrome.storage.local.get(['pasteMode', 'insertAt']);
    return { pasteMode, insertAt };
  },

  // Older versions stored a single markdown body; turn it into a one-file skill.
  normalize(skill) {
    if (Array.isArray(skill.files)) return skill;
    const files = skill.body
      ? [{ name: 'SKILL.md', type: 'text/markdown', encoding: 'utf8', content: skill.body }]
      : [];
    return { ...skill, files };
  },

  newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  // Slash command: lowercase letters, digits, - and _ only. "/PDF" -> "pdf".
  cleanCommand(raw) {
    return (raw || '').trim().replace(/^\//, '').toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  },

  MIME_BY_EXT: {
    md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json',
    csv: 'text/csv', html: 'text/html', css: 'text/css', js: 'text/javascript', py: 'text/x-python',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
  },

  guessMime(name) {
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return SkillStash.MIME_BY_EXT[ext] || 'application/octet-stream';
  },

  // Reads a File into storable form. Text stays as text; anything else is base64.
  async readAsStored(file) {
    const buf = await file.arrayBuffer();
    const type = file.type || SkillStash.guessMime(file.name);
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      if (!text.includes('\u0000')) return { type, encoding: 'utf8', content: text };
    } catch (_) { /* not valid UTF-8, store as binary */ }
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { type, encoding: 'base64', content: btoa(bin) };
  },

  // Rebuilds a real File object, with its original name, for attaching.
  storedToFile(f) {
    let blob;
    if (f.encoding === 'utf8') {
      blob = new Blob([f.content], { type: f.type });
    } else {
      const bin = atob(f.content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: f.type });
    }
    return new File([blob], f.name, { type: f.type });
  },

  // Keeps file names unique inside one skill: a.md, a-2.md, ...
  uniqueName(name, used) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let out = name, n = 2;
    while (used.has(out.toLowerCase())) out = `${base}-${n++}${ext}`;
    used.add(out.toLowerCase());
    return out;
  },

  // Parses optional YAML frontmatter (name, description, command) from a markdown file.
  parseSkillMarkdown(raw, filename = 'skill.md') {
    let text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const meta = {};
    const fm = text.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
    if (fm) {
      for (const line of fm[1].split('\n')) {
        const i = line.indexOf(':');
        if (i > 0) {
          const key = line.slice(0, i).trim();
          const val = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
          if (key) meta[key] = val;
        }
      }
      text = text.slice(fm[0].length);
    }
    const body = text.trim();
    if (!body) throw new Error(`${filename} is empty`);

    const heading = body.match(/^#\s+(.+)$/m);
    const base = filename.replace(/\.(md|markdown|txt)$/i, '');
    const name = (meta.name || (heading && heading[1]) || base).trim();

    let description = (meta.description || '').trim();
    if (!description) {
      description = body.split('\n').map(l => l.trim())
        .find(l => l && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('-')) || '';
    }
    return {
      name,
      description: description.slice(0, 300),
      command: SkillStash.cleanCommand(meta.command || ''),
      body
    };
  },

  // Adds a skill, or replaces the one with the same name (case-insensitive).
  // Fields that are undefined in the incoming object keep their stored value.
  upsert(skills, incoming) {
    const clean = Object.fromEntries(Object.entries(incoming).filter(([, v]) => v !== undefined));
    const key = clean.name.toLowerCase();
    const idx = skills.findIndex(s => s.name.toLowerCase() === key);
    if (idx >= 0) {
      skills[idx] = { ...skills[idx], ...clean, updatedAt: Date.now() };
      return 'updated';
    }
    skills.push({ id: SkillStash.newId(), ...clean, addedAt: Date.now() });
    return 'added';
  }
};

// ── Credits and update settings ─────────────────────────────────
// PLACEHOLDER: set `repo` to your GitHub "owner/repo" once it exists,
// e.g. 'Senku-San101/skill-stash'. Until then, update checks are skipped.
const SKILL_STASH_INFO = {
  author: 'Abdulrahman Kamal',
  website: 'https://abdulrahmankamal.netlify.app',
  github: 'https://github.com/Senku-San101',
  linkedin: 'https://www.linkedin.com/in/abdulrahman-kamal/',
  email: 'abdulrahmankamal609@gmail.com',
  repo: 'OWNER/REPO'
};

const SkillStashUpdates = {
  isConfigured() {
    const r = SKILL_STASH_INFO.repo;
    return /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith('OWNER/');
  },

  releasesUrl() {
    return SkillStashUpdates.isConfigured()
      ? `https://github.com/${SKILL_STASH_INFO.repo}/releases`
      : SKILL_STASH_INFO.github;
  },

  issuesUrl() {
    return SkillStashUpdates.isConfigured()
      ? `https://github.com/${SKILL_STASH_INFO.repo}/issues`
      : SKILL_STASH_INFO.github;
  },

  isNewer(a, b) {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  },

  // Checks the latest GitHub release at most once a day, unless force is true.
  // Returns { status: 'not-configured' | 'current' | 'update' | 'error', current, latest?, url?, message? }
  async check({ force = false } = {}) {
    const current = chrome.runtime.getManifest().version;
    if (!SkillStashUpdates.isConfigured()) return { status: 'not-configured', current };

    const { updateCheck } = await chrome.storage.local.get('updateCheck');
    const DAY = 24 * 60 * 60 * 1000;
    if (!force && updateCheck && updateCheck.result && Date.now() - updateCheck.checkedAt < DAY) {
      return { ...updateCheck.result, current };
    }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${SKILL_STASH_INFO.repo}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
      const data = await res.json();
      const latest = String(data.tag_name || '').replace(/^v/i, '');
      const result = SkillStashUpdates.isNewer(latest, current)
        ? { status: 'update', latest, url: data.html_url || SkillStashUpdates.releasesUrl() }
        : { status: 'current', latest };
      await chrome.storage.local.set({ updateCheck: { checkedAt: Date.now(), result } });
      return { ...result, current };
    } catch (err) {
      return { status: 'error', current, message: err.message };
    }
  }
};
