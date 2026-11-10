'use strict';

// This module runs only in the sandboxed renderer. Keep the allowed HTML small:
// preserving text, paragraphs, formatting, and the app's checkbox task markup.
(() => {
  const tags = new Set([
    'div', 'p', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'del', 'br', 'ul', 'ol', 'li', 'blockquote', 'input', 'font',
  ]);
  const blocked = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
    'svg', 'math', 'link', 'meta', 'base', 'form', 'button', 'textarea',
    'select', 'template', 'noscript', 'img', 'picture', 'source',
    'video', 'audio', 'canvas',
  ]);
  const allowedClass = new Set(['task-row', 'task-text', 'done']);
  const safeColor = (value) => /^#[0-9a-fA-F]{3,8}$/.test(value) ||
    /^(?:black|white|gray|grey|red|blue|green|yellow|purple|orange)$/i.test(value) ||
    /^rgba?\(\s*[\d.%,\s]+\)$/.test(value);

  function safeStyle(element, clean) {
    const source = element.style;
    const permitted = [
      ['font-size', v => /^\d+(?:\.\d+)?px$/.test(v) && parseFloat(v) >= 8 && parseFloat(v) <= 96],
      ['text-align', v => /^(?:left|right|center|justify|start|end)$/.test(v)],
      ['direction', v => /^(?:ltr|rtl)$/.test(v)],
      ['font-weight', v => /^(?:normal|bold|bolder|lighter|[1-9]00)$/.test(v)],
      ['font-style', v => /^(?:normal|italic|oblique)$/.test(v)],
      ['text-decoration', v => /^(?:none|underline|line-through|underline line-through)$/.test(v)],
      ['text-decoration-line', v => /^(?:none|underline|line-through|underline line-through)$/.test(v)],
      ['color', safeColor],
    ];
    for (const [property, valid] of permitted) {
      const value = source.getPropertyValue(property).trim().toLowerCase();
      if (value && valid(value)) clean.style.setProperty(property, value);
    }
  }

  function appendSafe(node, target) {
    if (node.nodeType === 3) {
      target.appendChild(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (blocked.has(tag)) return;
    if (!tags.has(tag)) {
      Array.from(node.childNodes).forEach(child => appendSafe(child, target));
      return;
    }
    if (tag === 'input' && (node.getAttribute('type') || '').toLowerCase() !== 'checkbox') return;
    const clean = document.createElement(tag);
    if (tag === 'input') {
      clean.setAttribute('type', 'checkbox');
      if (node.hasAttribute('checked')) clean.setAttribute('checked', '');
    } else {
      const classes = (node.getAttribute('class') || '').split(/\s+/)
        .filter(value => allowedClass.has(value));
      if (classes.length) clean.className = [...new Set(classes)].join(' ');
      if (tag === 'div' && clean.classList.contains('task-row')) {
        const id = node.getAttribute('id') || '';
        if (/^tk\d{6,18}$/.test(id)) clean.id = id;
      }
      if (tag === 'span' && clean.classList.contains('task-text')) {
        clean.setAttribute('contenteditable', 'true');
      }
      if (node.getAttribute('dir') === 'rtl' || node.getAttribute('dir') === 'ltr') {
        clean.setAttribute('dir', node.getAttribute('dir'));
      }
      if (tag === 'font') {
        const color = (node.getAttribute('color') || '').trim();
        if (safeColor(color)) clean.setAttribute('color', color);
        const size = node.getAttribute('size') || '';
        if (/^[1-7]$/.test(size)) clean.setAttribute('size', size);
      }
      safeStyle(node, clean);
      Array.from(node.childNodes).forEach(child => appendSafe(child, clean));
    }
    target.appendChild(clean);
  }

  function sanitize(input) {
    if (typeof input !== 'string') return '';
    const parsed = new DOMParser().parseFromString(input, 'text/html');
    const root = document.createElement('div');
    Array.from(parsed.body.childNodes).forEach(child => appendSafe(child, root));
    return root.innerHTML;
  }

  Object.defineProperty(window, 'RaysNoteHtml', {
    value: Object.freeze({ sanitize }), configurable: false, writable: false,
  });
})();
