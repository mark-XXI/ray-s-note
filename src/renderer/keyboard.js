'use strict';

// Keyboard shortcuts are intentionally limited to application-level commands.
// The editor keeps browser-native text selection, Ctrl+B/I/U and task Enter.
(() => {
  function modifier(event) {
    return (event.ctrlKey || event.metaKey) && !event.altKey;
  }
  function editable(target) {
    return !!target && !!target.closest && !!target.closest('input,textarea,[contenteditable="true"],[role="textbox"]');
  }
  function trigger(event, fn) {
    if (typeof fn !== 'function') return false;
    event.preventDefault();
    fn();
    return true;
  }
  function note(event, actions) {
    if (event.defaultPrevented || event.isComposing || event.key === 'Process') return false;
    const key = String(event.key).toLowerCase();
    if (modifier(event)) {
      if (!event.shiftKey && key === 'n') return trigger(event, actions.create);
      if (!event.shiftKey && key === 's') return trigger(event, actions.save);
      if (event.shiftKey && key === 'd') return trigger(event, actions.dashboard);
      if (event.shiftKey && key === 't') return trigger(event, actions.toolbar);
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === 'escape') {
      return trigger(event, actions.escape);
    }
    return false;
  }
  function dashboard(event, actions) {
    if (event.defaultPrevented || event.isComposing || event.key === 'Process') return false;
    const key = String(event.key).toLowerCase();
    if (modifier(event) && !event.shiftKey && key === 'n') return trigger(event, actions.create);
    if (modifier(event) && !event.shiftKey && key === 'f') return trigger(event, actions.search);
    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (key === '/' && !editable(event.target)) return trigger(event, actions.search);
      if (key === 'escape' && event.target?.id === 'search-input') return trigger(event, actions.clearSearch);
    }
    return false;
  }
  window.RaysNoteKeys = Object.freeze({ note, dashboard });
})();
