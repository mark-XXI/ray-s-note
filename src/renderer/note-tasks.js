'use strict';

// Keep checklists as non-editable block containers with one editable text field.
// Delegation below means newly created and restored rows behave identically.
(() => {
  function taskRow(node, editor) {
    const element = node && (node.nodeType === 1 ? node : node.parentElement);
    const row = element && element.closest('.task-row');
    return row && editor.contains(row) ? row : null;
  }

  function taskText(row) {
    return row && row.querySelector('.task-text');
  }

  function newTask(doc, text = '', checked = false) {
    const row = doc.createElement('div');
    row.className = 'task-row';
    row.setAttribute('contenteditable', 'false');

    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', 'Complete task');
    checkbox.checked = checked;
    if (checked) checkbox.setAttribute('checked', '');

    const label = doc.createElement('span');
    label.className = checked ? 'task-text done' : 'task-text';
    label.setAttribute('contenteditable', 'true');
    label.setAttribute('data-placeholder', 'New task');
    label.textContent = text;
    row.append(checkbox, label);
    return row;
  }

  function syncRow(row) {
    const checkbox = row.querySelector('input[type="checkbox"]');
    const label = taskText(row);
    if (!checkbox || !label) return false;
    row.setAttribute('contenteditable', 'false');
    label.setAttribute('contenteditable', 'true');
    label.setAttribute('data-placeholder', 'New task');
    checkbox.setAttribute('aria-label', 'Complete task');
    if (checkbox.checked) checkbox.setAttribute('checked', '');
    else checkbox.removeAttribute('checked');
    label.classList.toggle('done', checkbox.checked);
    return true;
  }

  function normalize(editor) {
    editor.querySelectorAll('.task-row').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      let label = taskText(row);
      // Preserve the text in legacy rows that have lost their inner span.
      if (checkbox && !label) {
        label = row.ownerDocument.createElement('span');
        label.className = 'task-text';
        for (const child of Array.from(row.childNodes)) {
          if (child !== checkbox) label.appendChild(child);
        }
        row.appendChild(label);
      }
      if (!checkbox || !label) return;
      checkbox.checked = checkbox.hasAttribute('checked') || checkbox.checked;
      syncRow(row);
    });
  }

  function focusText(row, atEnd = false) {
    const label = taskText(row);
    if (!label) return;
    label.focus();
    const sel = label.ownerDocument.defaultView.getSelection();
    if (!sel) return;
    const range = label.ownerDocument.createRange();
    range.selectNodeContents(label);
    range.collapse(!atEnd);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertionAnchor(editor, selection) {
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    let child = range.startContainer;
    if (child === editor) return editor.childNodes[range.startOffset - 1] || null;
    while (child.parentNode && child.parentNode !== editor) child = child.parentNode;
    return child.parentNode === editor ? child : null;
  }

  function insertAtSelection(editor, selection) {
    const row = newTask(editor.ownerDocument);
    const anchor = insertionAnchor(editor, selection);
    if (anchor) anchor.after(row);
    else editor.appendChild(row);
    focusText(row);
    return row;
  }

  function onCheckboxChange(event, editor) {
    const checkbox = event.target;
    if (!checkbox || checkbox.tagName !== 'INPUT' || checkbox.type !== 'checkbox') return false;
    const row = taskRow(checkbox, editor);
    return row ? syncRow(row) : false;
  }

  function isEmptyLabel(label) {
    return !label || !label.textContent.replace(/\u00a0/g, ' ').trim();
  }

  function insertTaskLineBreak(label) {
    const doc = label.ownerDocument;
    const selection = doc.defaultView.getSelection();
    if (!selection || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!label.contains(range.commonAncestorContainer) &&
        range.commonAncestorContainer !== label) return false;
    // Use a plain newline instead of a browser-generated DIV/BR. This is
    // reliably retained by the HTML sanitizer and the existing task serializer.
    const remainder = range.cloneRange();
    remainder.selectNodeContents(label);
    remainder.setStart(range.endContainer, range.endOffset);
    // A second newline is a trailing caret anchor when the split is at the
    // end of the editable span. Without it, Chromium moves the next keystroke
    // before the newline even though the selection says it is after it.
    const atEnd = remainder.toString().length === 0;
    range.deleteContents();
    const newline = doc.createTextNode(atEnd ? '\n\n' : '\n');
    range.insertNode(newline);
    range.setStart(newline, 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function onTaskKeydown(event, editor) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
    const node = event.target;
    if (!node || !node.classList || !node.classList.contains('task-text')) return false;
    const row = taskRow(node, editor);
    if (!row || taskText(row) !== node) return false;

    // Shift+Enter is a line break INSIDE the same task; Enter alone keeps the
    // established Batch 06 behavior of creating another checklist row.
    if (event.key === 'Enter' && event.shiftKey) {
      const inserted = insertTaskLineBreak(node);
      if (inserted) event.preventDefault();
      return inserted;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (isEmptyLabel(node)) {
        // Press Enter on an empty task to leave the checklist.
        const p = editor.ownerDocument.createElement('div');
        p.appendChild(editor.ownerDocument.createElement('br'));
        row.after(p);
        row.remove();
        p.focus?.();
        const range = editor.ownerDocument.createRange();
        range.setStart(p, 0);
        range.collapse(true);
        const sel = editor.ownerDocument.defaultView.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        const next = newTask(editor.ownerDocument);
        row.after(next);
        focusText(next);
      }
      return true;
    }
    if (event.key === 'Backspace' && isEmptyLabel(node)) {
      event.preventDefault();
      const previous = row.previousElementSibling;
      row.remove();
      if (previous && previous.classList.contains('task-row')) focusText(previous, true);
      else if (previous) {
        editor.focus();
        const range = editor.ownerDocument.createRange();
        range.selectNodeContents(previous);
        range.collapse(false);
        const sel = editor.ownerDocument.defaultView.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } else editor.focus();
      return true;
    }
    return false;
  }

  function serializedHTML(editor) {
    // An input's checked property does not automatically update its HTML
    // attribute. Clone and reconcile both before persisting content.
    const clone = editor.cloneNode(true);
    const live = editor.querySelectorAll('.task-row');
    const copies = clone.querySelectorAll('.task-row');
    live.forEach((row, index) => {
      const source = row.querySelector('input[type="checkbox"]');
      const copy = copies[index];
      if (!source || !copy) return;
      const cb = copy.querySelector('input[type="checkbox"]');
      const label = copy.querySelector('.task-text');
      if (!cb || !label) return;
      if (source.checked) cb.setAttribute('checked', '');
      else cb.removeAttribute('checked');
      label.classList.toggle('done', source.checked);
      copy.setAttribute('contenteditable', 'false');
      label.setAttribute('contenteditable', 'true');
    });
    return clone.innerHTML;
  }

  Object.defineProperty(window, 'RaysNoteTasks', {
    value: Object.freeze({ normalize, insertAtSelection, onCheckboxChange, onTaskKeydown, serializedHTML }),
    configurable: false, writable: false,
  });
})();
