# Skill Stash 1.2

Stores AI skills as files and attaches them to the chat box of ChatGPT, Claude, Gemini, DeepSeek or Qwen, the same way a file dropped from your file explorer would be attached.

## Install (unpacked)

1. Unzip the folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `skill-stash-extension` folder.

## Manage skills

Click the Skill Stash toolbar icon, then **Open Skill Stash**. Importing and managing happen in a full browser tab. The file dialog would close the small popup and lose the import, so the tab is used instead.

- **+ Files**: select one or more files. For one file you're asked for a name. For several, you're asked for one name for the group, or you can tick "Save each file as its own skill".
- **+ Folder**: pick a folder. You're asked for a name (pre-filled from `SKILL.md` or the folder name). Every file in the folder is saved with its name and content, as a separate file. `SKILL.md` goes first. Hidden files are skipped.
- Name and description are read from frontmatter when present:

```markdown
---
name: Plain English Explainer
description: Explain a topic simply, then quiz me.
---
```

- Importing a skill with a name that already exists replaces it.
- Deleting asks for confirmation in the tab.

## Use a skill

1. Open a supported chat site.
2. In the chat box, type `/` followed by the skill's command (for example `/pdf`).
3. Pick the skill from the small menu with the arrow keys and Enter, or click it. The typed command is removed and the skill's files are attached.

Skills without a command can't be used from the chat box yet. Set a command when you import a skill, or with **Edit** on its card.

Settings (in the tab):

- **Paste as: files (attached)** attaches each file separately. This is the default.
- **Paste as: text (typed)** types the skill's `SKILL.md` (or first `.md` file) into the box. The **start/end** setting applies here.

## How file attachment works

The extension builds real file objects and tries, in order:

1. a `paste` event on the chat input,
2. a `drop` event on the chat input,
3. the page's hidden `<input type="file">`.

The first one the page accepts is used. If none works, a toast says so.

## Testing per site

Check each site: ChatGPT, Claude, Gemini, DeepSeek, and Qwen. Sites differ in how they accept files. To change the method, edit `pasteSkill` and the `attach*` functions in `content.js`. If a site's input box isn't found, add its selector to `INPUT_SELECTORS`.

## Limits

- Files attached this way are only as useful as the model's file support. Some sites accept only certain file types.
- If a page accepts both paste and drop, the files could be attached twice. The code stops at the first method the page accepts, but a site that handles paste without `preventDefault()` may still trigger the fallback.
- Skills that need code execution or file creation (like Claude's docx or pptx skills) only give the model instructions. The model can't run them in a web chat.
- Skills are stored in `chrome.storage.local`. Nothing is sent to a server. Binary files are stored as base64 and take more space.

## Backup

**Export backup** saves all skills (with their files) to JSON. **Restore backup** merges a JSON file back in.

## Updates

Skill Stash checks the latest GitHub release once a day and shows a banner in the manager tab and a line in the popup when a newer version exists. You can also press **Check for updates** in the About section.

Update checks are off until the repository is set. To turn them on, edit `SKILL_STASH_INFO.repo` in `shared.js`:

```js
repo: 'OWNER/REPO'   // replace with e.g. 'Senku-San101/skill-stash'
```

The extension doesn't install updates by itself. When an update is found, download the new release from GitHub and load it again with **Load unpacked**.

## Credits

Skill Stash by **Abdulrahman Kamal**

- Website: https://abdulrahmankamal.netlify.app
- GitHub: https://github.com/Senku-San101
- LinkedIn: https://www.linkedin.com/in/abdulrahman-kamal/
- Email: abdulrahmankamal609@gmail.com

Bugs and feature requests are welcome through GitHub or email.
