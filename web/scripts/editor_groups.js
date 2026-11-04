'use strict';
const groupExpansion = new Map();
function editorGroup(key, title, content, forceOpen = false) {
  const section = document.createElement('section');
  section.className = 'editor-group';
  section.dataset.group = key;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'group-heading';
  button.textContent = title;
  button.id = `group-${key}`;
  const body = document.createElement('div');
  body.className = 'group-body';
  body.id = `group-body-${key}`;
  button.setAttribute('aria-controls', body.id);
  const inner = document.createElement('div');
  inner.className = 'group-content';
  inner.append(content);
  body.append(inner);
  function expand(open) {
    button.setAttribute('aria-expanded', String(open));
    body.classList.toggle('collapsed', !open);
    inner.inert = !open;
  }
  expand(forceOpen || (groupExpansion.get(key) ?? true));
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    groupExpansion.set(key, open);
    expand(open);
  });
  section.append(button, body);
  return section;
}
function mountEditorGroup(id, title) {
  const host = document.getElementById(id);
  if (!host) return;
  const heading = host.querySelector(':scope > h2');
  if (
    heading &&
    !heading.querySelector('[id]') &&
    heading.textContent.trim().toLowerCase() === title.toLowerCase()
  )
    heading.remove();
  const content = document.createElement('div');
  while (host.firstChild) content.append(host.firstChild);
  host.append(editorGroup(id, title, content));
}
