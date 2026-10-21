(() => {
  if (window.__skillStashLoaded) return;
  window.__skillStashLoaded = true;

  // Chat input selectors, most specific first. Add a line here if a site changes its input.
  const INPUT_SELECTORS = [
    'textarea#prompt-textarea',                          // ChatGPT
    'div#prompt-textarea[contenteditable="true"]',       // ChatGPT (newer)
    'div.ql-editor[contenteditable="true"]',             // Gemini
    'div.ProseMirror[contenteditable="true"]',           // Claude
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder]',                             // DeepSeek, Qwen
    'textarea',
    'div[contenteditable="true"]'
  ];

  const isVisible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };

  function findInput() {
    for (const sel of INPUT_SELECTORS) {
      const hits = [...document.querySelectorAll(sel)].filter(isVisible);
      if (hits.length) return hits[hits.length - 1]; // the chat box is usually the last one
    }
    return null;
  }

  // The editable element a DOM event came from, or null.
  function editableOf(target) {
    if (!target || !target.tagName) return null;
    if (target.tagName === 'TEXTAREA') return target;
    if (target.tagName === 'INPUT' && /^(text|search)$/i.test(target.type)) return target;
    return (target.closest && target.closest('[contenteditable="true"], [contenteditable=""]')) || null;
  }

  function setValue(el, v) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── Text mode: type the skill's markdown into the input ──────────
  // where: 'start' | 'end' | 'caret'
  function insertText(el, text, where) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const cur = el.value;
      let next, caret;
      if (where === 'caret') {
        const pos = el.selectionStart ?? cur.length;
        next = cur.slice(0, pos) + text + cur.slice(pos);
        caret = pos + text.length;
      } else if (where === 'start') {
        next = text + (cur ? '\n\n' + cur : '');
        caret = text.length;
      } else {
        next = (cur ? cur + '\n\n' : '') + text;
        caret = next.length;
      }
      setValue(el, next);
      el.setSelectionRange(caret, caret);
      return;
    }

    if (where === 'caret') {
      text.split('\n').forEach((line, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        if (line) document.execCommand('insertText', false, line);
      });
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const hasText = el.textContent.trim().length > 0;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(where !== 'start');
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    let lines;
    if (where === 'start') lines = [...text.split('\n'), ...(hasText ? ['', ''] : [])];
    else lines = [...(hasText ? ['', ''] : []), ...text.split('\n')];

    lines.forEach((line, i) => {
      if (i > 0) document.execCommand('insertParagraph');
      if (line) document.execCommand('insertText', false, line);
    });
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ── File mode: attach each file separately, as if dropped or pasted ──
  // Each returns true if the page appears to have accepted the files.
  function attachViaPaste(el, dt) {
    el.focus();
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  function attachViaDrop(el, dt) {
    const opts = { dataTransfer: dt, bubbles: true, cancelable: true };
    el.dispatchEvent(new DragEvent('dragenter', opts));
    el.dispatchEvent(new DragEvent('dragover', opts));
    const ev = new DragEvent('drop', opts);
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  function attachViaFileInput(dt) {
    const inputs = [...document.querySelectorAll('input[type="file"]')].filter(i => !i.disabled);
    const input = inputs[inputs.length - 1];
    if (!input) return false;
    try { input.files = dt.files; } catch (_) { return false; }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Attaches or types a skill into `target` (defaults to the page's chat box).
  // placement: 'start' | 'end' | 'caret' (text mode only). Defaults to the saved setting.
  async function pasteSkill(skill, target, placement) {
    const settings = await SkillStash.getSettings();
    const el = target || findInput();
    if (!el) { toast('No chat input found on this page.'); return; }

    if (settings.pasteMode === 'text') {
      const md = skill.files.find(f => /^skill\.md$/i.test(f.name) && f.encoding === 'utf8')
        || skill.files.find(f => f.encoding === 'utf8' && /\.(md|markdown|txt)$/i.test(f.name));
      if (!md) { toast('This skill has no text file to paste.'); return; }
      try {
        insertText(el, md.content, placement || settings.insertAt);
        toast(`Pasted "${skill.name}"`);
      } catch (_) {
        toast('Could not insert text.');
      }
      return;
    }

    const dt = new DataTransfer();
    skill.files.forEach(f => dt.items.add(SkillStash.storedToFile(f)));
    const ok = attachViaPaste(el, dt) || attachViaDrop(el, dt) || attachViaFileInput(dt);
    toast(ok
      ? `Attached ${skill.files.length} file${skill.files.length === 1 ? '' : 's'} from "${skill.name}"`
      : 'This site did not accept the files.');
  }

  // ── Shadow-root UI: slash menu and status toast ─────────────────
  const host = document.createElement('div');
  host.id = 'skill-stash-host';
  host.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

      .toast {
        position: fixed; left: 12px; bottom: 12px; max-width: 320px;
        background: #111; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 8px;
        opacity: 0; transition: opacity .2s; pointer-events: none; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .toast.show { opacity: 1; }

      .slash {
        position: fixed; z-index: 2147483647; width: 340px; max-width: calc(100vw - 16px);
        max-height: 300px; overflow-y: auto; padding: 4px;
        background: #fff; color: #111; border: 1px solid #d0d0d8; border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0,0,0,.2);
      }
      .slash[hidden] { display: none; }
      .s-head { font-size: 11px; color: #888; padding: 5px 9px 3px; }
      .s-item {
        display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 9px;
        border: 0; background: transparent; border-radius: 7px; text-align: left; cursor: pointer; color: #111;
      }
      .s-item.sel, .s-item:hover { background: #f0f0f5; }
      .s-cmd {
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; font-weight: 600;
        color: #333; flex-shrink: 0; min-width: 56px;
      }
      .s-text { min-width: 0; flex: 1; display: flex; flex-direction: column; }
      .s-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .s-desc { font-size: 12px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      @media (prefers-color-scheme: dark) {
        .slash { background: #1e1e22; color: #eee; border-color: #3a3a42; }
        .s-item { color: #eee; }
        .s-item.sel, .s-item:hover { background: #2c2c34; }
        .s-desc, .s-head { color: #aaa; }
        .s-cmd { color: #ddd; }
      }
    </style>
    <div class="slash" hidden></div>
    <div class="toast"></div>
  `;

  const toastEl = root.querySelector('.toast');
  const slashMenu = root.querySelector('.slash');
  let skills = [];
  let toastTimer;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  // ── Slash menu: type "/" in the chat box ───────────────────────
  let slash = null; // { el, query, items, index }

  // Text between the start of the input and the caret.
  function textBeforeCaret(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      return el.value.slice(0, el.selectionStart ?? 0);
    }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return '';
    const caret = sel.getRangeAt(0);
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setEnd(caret.endContainer, caret.endOffset);
    return r.toString();
  }

  // Returns the text typed after a "/" at the start of a word, or null.
  function slashQuery(text) {
    const m = text.match(/(?:^|\s)\/([a-z0-9_-]*)$/i);
    return m ? m[1].toLowerCase() : null;
  }

  function hideSlash() {
    slash = null;
    slashMenu.hidden = true;
  }

  function positionSlash(el) {
    const r = el.getBoundingClientRect();
    slashMenu.style.left = `${Math.max(8, r.left)}px`;
    slashMenu.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }

  function renderSlash() {
    slashMenu.innerHTML = '';
    const head = document.createElement('div');
    head.className = 's-head';
    head.textContent = 'Skill commands';
    slashMenu.appendChild(head);

    slash.items.forEach((skill, i) => {
      const b = document.createElement('button');
      b.className = 's-item' + (i === slash.index ? ' sel' : '');

      const cmd = document.createElement('span');
      cmd.className = 's-cmd';
      cmd.textContent = `/${skill.command}`;

      const text = document.createElement('span');
      text.className = 's-text';
      const name = document.createElement('span');
      name.className = 's-name';
      name.textContent = skill.name;
      const desc = document.createElement('span');
      desc.className = 's-desc';
      const n = skill.files.length;
      desc.textContent = `${n} file${n === 1 ? '' : 's'}${skill.description ? ' · ' + skill.description : ''}`;
      text.append(name, desc);

      b.append(cmd, text);
      // mousedown keeps focus in the chat box
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => chooseSlash(i));
      b.addEventListener('mouseenter', () => { slash.index = i; highlightSlash(); });
      slashMenu.appendChild(b);
    });
    slashMenu.hidden = false;
  }

  function highlightSlash() {
    [...slashMenu.querySelectorAll('.s-item')].forEach((el, i) => {
      el.classList.toggle('sel', i === slash.index);
    });
    const sel = slashMenu.querySelector('.s-item.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function onEdit(e) {
    const el = editableOf(e.target);
    if (!el) return hideSlash();
    const q = slashQuery(textBeforeCaret(el));
    if (q === null) return hideSlash();

    const items = skills
      .filter(s => s.command && (!q || s.command.includes(q)))
      .sort((a, b) => (a.command.startsWith(q) ? 0 : 1) - (b.command.startsWith(q) ? 0 : 1))
      .slice(0, 8);
    if (!items.length) return hideSlash();

    slash = { el, query: q, items, index: 0 };
    renderSlash();
    positionSlash(el);
  }

  // Removes the typed "/query" (n characters, including the slash) before the caret.
  function removeTyped(el, n) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const pos = el.selectionStart;
      setValue(el, el.value.slice(0, pos - n) + el.value.slice(pos));
      el.setSelectionRange(pos - n, pos - n);
      return;
    }
    el.focus();
    const sel = window.getSelection();
    for (let i = 0; i < n; i++) sel.modify('extend', 'backward', 'character');
    document.execCommand('delete');
  }

  async function chooseSlash(i) {
    const s = slash;
    if (!s) return;
    const skill = s.items[i];
    const el = s.el;
    const n = s.query.length + 1;
    hideSlash();
    removeTyped(el, n);
    const { pasteMode, insertAt } = await SkillStash.getSettings();
    pasteSkill(skill, el, pasteMode === 'text' ? 'caret' : insertAt);
  }

  // Keys go to the menu first while it is open. Capture phase, so the site doesn't see them.
  window.addEventListener('keydown', e => {
    if (!slash || e.isComposing) return;
    if (editableOf(e.target) !== slash.el) return;

    let handled = true;
    if (e.key === 'ArrowDown') {
      slash.index = (slash.index + 1) % slash.items.length;
      highlightSlash();
    } else if (e.key === 'ArrowUp') {
      slash.index = (slash.index - 1 + slash.items.length) % slash.items.length;
      highlightSlash();
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
      chooseSlash(slash.index);
    } else if (e.key === 'Escape') {
      hideSlash();
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('input', onEdit, true);
  document.addEventListener('keyup', e => {
    // caret moves (arrows, clicks) can change what's before the caret
    if (!slash) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) onEdit(e);
  }, true);
  document.addEventListener('focusout', e => {
    if (slash && e.target === slash.el) hideSlash();
  }, true);
  document.addEventListener('mousedown', e => {
    if (!e.composedPath().includes(host)) hideSlash();
  });

  // ── Load skills + live updates ──
  (async () => { skills = await SkillStash.getSkills(); })();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.skills) {
      skills = (changes.skills.newValue || []).map(SkillStash.normalize);
    }
  });
})();
