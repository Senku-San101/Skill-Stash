document.addEventListener('DOMContentLoaded', async () => {
  const skills = await SkillStash.getSkills();
  document.getElementById('count').textContent =
    `${skills.length} skill${skills.length === 1 ? '' : 's'} saved`;

  const { dismissedVersion } = await chrome.storage.local.get('dismissedVersion');
  const info = await SkillStashUpdates.check();
  if (info.status === 'update' && info.latest !== dismissedVersion) {
    const line = document.getElementById('update-line');
    line.hidden = false;
    line.textContent = `Version ${info.latest} is available. You have ${info.current}. `;
    const a = document.createElement('a');
    a.href = info.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Get it';
    line.appendChild(a);
  }
});

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
  window.close();
});
