'use strict';

// Stable list behavior for contenteditable: do not depend on execCommand's
// insertUnorderedList implementation, which fails in some Electron contexts.
(() => {
  function isWithin(editor, node) {
    return !!node && (node === editor || editor.contains(node));
  }

  function elementOf(node) {
    return node && (node.nodeType === 1 ? node : node.parentElement);
  }

  function closestListItem(editor, node) {
    const element = elementOf(node);
    const item = element?.closest('li');
    if (!item || !isWithin(editor, item)) return null;
    const list = item.parentElement;
    return list && (list.tagName === 'UL' || list.tagName === 'OL') ? item : null;
  }

  function topLevelChild(editor, node, offset = 0) {
    if (!isWithin(editor, node)) return null;
    if (node === editor) return editor.childNodes[offset] || editor.childNodes[offset - 1] || null;
    let top = node;
    while (top.parentNode && top.parentNode !== editor) top = top.parentNode;
    return top.parentNode === editor ? top : null;
  }

  function focusEnd(node) {
    const doc = node.ownerDocument;
    const selection = doc.defaultView.getSelection();
    if (!selection) return;
    const range = doc.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    node.closest('[contenteditable="true"]')?.focus();
  }

  function moveContents(source, target) {
    while (source.firstChild) target.appendChild(source.firstChild);
  }

  function newList(doc) {
    const list = doc.createElement('ul');
    const item = doc.createElement('li');
    item.appendChild(doc.createElement('br'));
    list.appendChild(item);
    return { list, item };
  }

  function selectedBlocks(editor, selection) {
    if (!selection || !selection.rangeCount) return [];
    const range = selection.getRangeAt(0);
    if (!isWithin(editor, range.startContainer)) return [];
    const start = topLevelChild(editor, range.startContainer, range.startOffset);
    const end = topLevelChild(editor, range.endContainer,
      range.endContainer === editor && range.endOffset > 0 ? range.endOffset - 1 : range.endOffset);
    if (!start || !end) return start ? [start] : [];
    const children = Array.from(editor.childNodes);
    const first = children.indexOf(start);
    const last = children.indexOf(end);
    if (!range.collapsed && first >= 0 && last >= first) return children.slice(first, last + 1);
    return [start];
  }

  function copyBlockFormatting(source, item) {
    if (source.nodeType !== 1) return;
    if (source.hasAttribute('dir')) item.setAttribute('dir', source.getAttribute('dir'));
    for (const prop of ['text-align', 'direction', 'font-size']) {
      const value = source.style.getPropertyValue(prop);
      if (value) item.style.setProperty(prop, value);
    }
  }

  function toList(editor, selection) {
    const doc = editor.ownerDocument;
    const blocks = selectedBlocks(editor, selection);
    const target = blocks[0] || null;
    const { list, item } = newList(doc);

    if (target && target.nodeType === 1 && target.classList.contains('task-row')) {
      // A checklist item remains an intact, non-editable block.
      target.after(list);
    } else if (target && target.nodeType === 1 &&
      (target.tagName === 'UL' || target.tagName === 'OL')) {
      target.after(list);
    } else if (blocks.length && blocks.every(block =>
      block.parentNode === editor && !block.querySelector?.('.task-row') &&
      !['UL', 'OL'].includes(block.tagName))) {
      // Convert one or more selected paragraphs to actual LI elements. The
      // original inline content and formatting are moved, never dropped.
      editor.insertBefore(list, target);
      blocks.forEach((block, index) => {
        const li = index === 0 ? item : doc.createElement('li');
        if (index === 0) li.removeChild(li.firstChild);
        copyBlockFormatting(block, li);
        if (block.nodeType === 3 || block.tagName === 'BR') li.appendChild(block);
        else { moveContents(block, li); block.remove(); }
        if (!li.childNodes.length) li.appendChild(doc.createElement('br'));
        if (index > 0) list.appendChild(li);
      });
    } else if (target) {
      target.after(list);
    } else {
      editor.appendChild(list);
    }
    focusEnd(list.lastElementChild || item);
    return true;
  }

  function unlist(item) {
    const list = item.parentElement;
    const doc = item.ownerDocument;
    const block = doc.createElement('div');
    copyBlockFormatting(item, block);
    moveContents(item, block);
    if (!block.childNodes.length) block.appendChild(doc.createElement('br'));

    // If the list contains several items, keep those before/after this item
    // in separate lists, rather than discarding the neighbouring bullets.
    const before = list.cloneNode(false);
    const after = list.cloneNode(false);
    let passed = false;
    for (const child of Array.from(list.children)) {
      if (child === item) { passed = true; continue; }
      if (child.tagName !== 'LI') continue;
      (passed ? after : before).appendChild(child);
    }
    const fragment = doc.createDocumentFragment();
    if (before.children.length) fragment.appendChild(before);
    fragment.appendChild(block);
    if (after.children.length) fragment.appendChild(after);
    list.replaceWith(fragment);
    focusEnd(block);
    return true;
  }

  function toggle(editor, selection) {
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    const anchor = range && isWithin(editor, range.startContainer) ? range.startContainer : null;
    const currentItem = closestListItem(editor, anchor);
    return currentItem ? unlist(currentItem) : toList(editor, selection);
  }

  Object.defineProperty(window, 'RaysNoteBullets', {
    value: Object.freeze({ toggle }), configurable: false, writable: false,
  });
})();
