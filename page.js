(() => {
  const key = '__cssSelectorExtractorPicker';
  const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c));
  const selectorFor = el => {
    if (!(el instanceof Element)) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.id) { parts.unshift('#' + esc(node.id)); break; }
      let part = node.localName;
      const classes = [...node.classList].filter(Boolean).slice(0, 2);
      if (classes.length) part += classes.map(c => '.' + esc(c)).join('');
      if (node.parentElement) {
        try {
          if (node.parentElement.querySelectorAll(':scope > ' + part).length > 1) {
            const siblings = [...node.parentElement.children].filter(e => e.localName === node.localName);
            part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
          }
        } catch (_) { /* use tag selector */ }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const read = (el, mode) => {
    if (!el) return '';
    if (mode === 'href') return el.getAttribute('href') || '';
    if (mode === 'src') return el.getAttribute('src') || '';
    if (mode === 'value') return 'value' in el ? String(el.value) : el.getAttribute('value') || '';
    return (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
  };
  const countMatches = config => {
    const container = (config.container || '').trim();
    const validate = (selector, label) => {
      if (!selector.trim()) throw new Error(label + ' selector is empty.');
      try { return document.querySelectorAll(selector); }
      catch (error) { throw new Error('Invalid ' + label + ' selector: ' + error.message); }
    };
    const parents = container ? [...validate(container, 'Row container')] : [];
    return {
      hasContainer: Boolean(container), rowCount: parents.length,
      columns: config.columns.map((col, index) => {
        const selector = col.selector.trim();
        const matches = validate(selector, 'Column ' + (index + 1));
        const withinRows = container ? parents.filter(parent => parent.matches(selector) || parent.querySelector(selector)).length : matches.length;
        return {index, name: col.name || selector, count: matches.length, withinRows};
      })
    };
  };
  const extract = config => {
    const cols = config.columns;
    const container = (config.container || '').trim();
    const selectors = cols.map(c => c.selector.trim());
    const validate = s => { if (!s) throw new Error('A CSS selector is empty.'); document.querySelector(s); };
    if (container) validate(container);
    selectors.forEach(validate);
    let rows;
    if (container) {
      rows = [...document.querySelectorAll(container)].map(parent => cols.map((col, i) => read(parent.matches(selectors[i]) ? parent : parent.querySelector(selectors[i]), col.mode)));
    } else {
      const lists = cols.map((col, i) => [...document.querySelectorAll(selectors[i])].map(el => read(el, col.mode)));
      const length = Math.max(0, ...lists.map(l => l.length));
      rows = Array.from({length}, (_, i) => lists.map(list => list[i] || ''));
    }
    return {headers:cols.map(c => c.name || c.selector),rows};
  };
  const stopPicker = () => {
    const state = window[key];
    if (!state) return;
    document.removeEventListener('mousemove', state.move, true);
    document.removeEventListener('keydown', state.keydown, true);
    document.removeEventListener('click', state.click, true);
    state.tooltip.remove();state.outline.remove();delete window[key];
  };
  const startPicker = () => {
    stopPicker();
    const tooltip = document.createElement('div');
    const outline = document.createElement('div');
    const base = 'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;box-sizing:border-box!important;';
    tooltip.style.cssText = base + 'background:#111827!important;color:white!important;font:12px/1.5 monospace!important;padding:7px 10px!important;border-radius:5px!important;max-width:460px!important;overflow-wrap:anywhere!important;box-shadow:0 2px 10px #0004!important;';
    outline.style.cssText = base + 'border:2px solid #2563eb!important;background:#2563eb18!important;';
    document.documentElement.append(outline, tooltip);
    let target = null;
    const move = e => {
      if (e.target === tooltip || e.target === outline) return;
      target = e.target;
      const rect = target.getBoundingClientRect();
      Object.assign(outline.style, {left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
      tooltip.textContent = selectorFor(target) + '  [C: copy | Esc: close]';
      tooltip.style.left = Math.min(e.clientX+14, window.innerWidth- Math.min(460, window.innerWidth-20))+'px';
      tooltip.style.top = (e.clientY+45>window.innerHeight?Math.max(0,e.clientY-65):e.clientY+16)+'px';
    };
    const keydown = async e => {
      if (e.key === 'Escape') {e.preventDefault();e.stopPropagation();stopPicker();return;}
      if (e.key.toLowerCase() !== 'c' || e.ctrlKey || e.metaKey || e.altKey || !target) return;
      if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')) return;
      e.preventDefault();e.stopPropagation();
      const selector = selectorFor(target);
      try { await navigator.clipboard.writeText(selector); }
      catch (_) {
        const input=document.createElement('textarea');input.value=selector;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove();
      }
      const {pickerTarget} = await chrome.storage.local.get('pickerTarget');
      const pendingPick = {
        selector,
        index: pickerTarget && Number.isInteger(pickerTarget.index) ? pickerTarget.index : null,
        tabId: pickerTarget?.tabId ?? null,
        pickedAt: Date.now()
      };
      await chrome.storage.local.set({lastPickedSelector:selector,pendingPick});
      tooltip.textContent = 'Copied + saved for popup: ' + selector;
    };
    const click = e => {if (!target) return;e.preventDefault();e.stopImmediatePropagation();};
    document.addEventListener('mousemove',move,true);document.addEventListener('keydown',keydown,true);document.addEventListener('click',click,true);
    window[key]={move,keydown,click,tooltip,outline};
  };
  if (!window.__cssSelectorExtractorListener) {
    chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
      try {
        if (message.type === 'COUNT') sendResponse({ok:true,data:countMatches(message.config)});
        else if (message.type === 'EXTRACT') sendResponse({ok:true,data:extract(message.config)});
        else if (message.type === 'PICK') {startPicker();sendResponse({ok:true});}
        else if (message.type === 'STOP_PICK') {stopPicker();sendResponse({ok:true});}
      } catch (error) {sendResponse({ok:false,error:error.message});}
    });
    window.__cssSelectorExtractorListener=true;
  }
})();
