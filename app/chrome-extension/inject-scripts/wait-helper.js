/* eslint-disable */
// wait-helper.js
// Listen for text appearance/disappearance in the current document using MutationObserver.
// Returns a stable ref (compatible with accessibility-tree-helper) for the first matching element.

(function () {
  if (window.__WAIT_HELPER_INITIALIZED__) return;
  window.__WAIT_HELPER_INITIALIZED__ = true;

  // Ensure ref mapping infra exists (compatible with accessibility-tree-helper.js)
  if (!window.__claudeElementMap) window.__claudeElementMap = {};
  if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;

  function isVisible(el) {
    try {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
        return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  function normalize(str) {
    return String(str || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function* walkAllElementsDeep(root) {
    const start = root || document.documentElement || document.body;
    if (!start) return;

    const stack = [start];
    const seen = new Set();
    const MAX = 12000;
    let count = 0;

    while (stack.length) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (++count > MAX) break;

      if (node instanceof Element) {
        yield node;
      }

      try {
        const children = node.children ? Array.from(node.children) : [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      } catch {}

      try {
        const sr = node instanceof Element ? node.shadowRoot : null;
        if (sr && sr.children) {
          const srChildren = Array.from(sr.children);
          for (let i = srChildren.length - 1; i >= 0; i--) stack.push(srChildren[i]);
        }
      } catch {}
    }
  }

  function collectObserverRoots() {
    const roots = [];
    const rootEl = document.documentElement || document.body;
    if (rootEl) roots.push(rootEl);

    for (const node of walkAllElementsDeep(rootEl)) {
      try {
        const sr = node.shadowRoot;
        if (sr) roots.push(sr);
      } catch {}
    }

    return roots;
  }

  function querySelectorDeepFirst(selector) {
    try {
      const direct = document.querySelector(selector);
      if (direct) return direct;
    } catch {}

    for (const node of walkAllElementsDeep(document.documentElement || document.body)) {
      try {
        if (node.matches && node.matches(selector)) return node;
      } catch {}
    }

    return null;
  }

  function querySelectorAllDeep(selector) {
    const out = [];
    const seen = new Set();

    try {
      const direct = document.querySelectorAll(selector);
      for (const node of Array.from(direct)) {
        if (node instanceof Element && !seen.has(node)) {
          seen.add(node);
          out.push(node);
        }
      }
    } catch {}

    for (const node of walkAllElementsDeep(document.documentElement || document.body)) {
      try {
        if (node.matches && node.matches(selector) && !seen.has(node)) {
          seen.add(node);
          out.push(node);
        }
      } catch {}
    }

    return out;
  }

  function matchesText(el, needle) {
    const t = normalize(needle);
    if (!t) return false;
    try {
      if (!isVisible(el)) return false;
      const aria = el.getAttribute('aria-label');
      if (aria && normalize(aria).includes(t)) return true;
      const title = el.getAttribute('title');
      if (title && normalize(title).includes(t)) return true;
      const alt = el.getAttribute('alt');
      if (alt && normalize(alt).includes(t)) return true;
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && normalize(placeholder).includes(t)) return true;
      // input/textarea value
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const value = el.value || el.getAttribute('value');
        if (value && normalize(value).includes(t)) return true;
      }
      const text = el.innerText || el.textContent || '';
      if (normalize(text).includes(t)) return true;
    } catch {}
    return false;
  }

  function findElementByText(text) {
    // Fast path: query common interactive elements first
    const prioritized = querySelectorAllDeep('a,button,input,textarea,select,label,summary,[role]');
    for (const el of prioritized) if (matchesText(el, text)) return el;

    // Fallback: broader scan with cap to avoid blocking on huge pages
    let count = 0;
    for (const el of walkAllElementsDeep(document.body || document.documentElement)) {
      if (matchesText(el, text)) return el;
      if (++count > 5000) break; // Hard cap to avoid long scans
    }
    return null;
  }

  function ensureRefForElement(el) {
    // Try to reuse an existing ref
    for (const k in window.__claudeElementMap) {
      const weak = window.__claudeElementMap[k];
      if (weak && typeof weak.deref === 'function' && weak.deref() === el) return k;
    }
    const refId = `ref_${++window.__claudeRefCounter}`;
    window.__claudeElementMap[refId] = new WeakRef(el);
    return refId;
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }

  function queryElement(selector, isXPath) {
    try {
      if (!selector) return null;
      if (isXPath) {
        const result = document.evaluate(
          selector,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        );
        return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
      }
      return querySelectorDeepFirst(selector);
    } catch {
      return null;
    }
  }

  function queryVisibleElement(selector, isXPath) {
    if (isXPath) {
      const match = queryElement(selector, true);
      return match && isVisible(match) ? match : null;
    }

    const matches = querySelectorAllDeep(selector);
    for (const match of matches) {
      if (isVisible(match)) return match;
    }
    return null;
  }

  function hasVisibleElement(selector, isXPath) {
    return !!queryVisibleElement(selector, isXPath);
  }

  function queryClickableElement(selector, isXPath) {
    if (isXPath) {
      const match = queryElement(selector, true);
      return match && isClickable(match) ? match : null;
    }

    const matches = querySelectorAllDeep(selector);
    for (const match of matches) {
      if (isClickable(match)) return match;
    }
    return null;
  }

  function resolveRef(ref) {
    if (!ref) return null;
    const map = window.__claudeElementMap || {};
    const weak = map[ref];
    const el = weak && typeof weak.deref === 'function' ? weak.deref() : null;
    return el instanceof Element ? el : null;
  }

  function isClickable(el) {
    try {
      if (!isVisible(el)) return false;
      const style = getComputedStyle(el);
      if (style.pointerEvents === 'none') return false;
      if (el.matches('[disabled],[aria-disabled="true"]')) return false;
      if (el.closest('[disabled],[aria-disabled="true"]')) return false;
      return true;
    } catch {
      return false;
    }
  }

  function watchForChanges(check) {
    const observer = new MutationObserver(() => {
      refresh();
      check();
    });
    const observedRoots = new Set();
    const interval = setInterval(check, 100);

    const refresh = () => {
      for (const root of collectObserverRoots()) {
        if (!root || observedRoots.has(root)) continue;
        observedRoots.add(root);
        try {
          observer.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });
        } catch {}
      }
    };

    refresh();

    return () => {
      clearInterval(interval);
      observer.disconnect();
    };
  }

  function waitFor({ text, appear = true, timeout = 5000 }) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;
      let stopWatching = null;
      let timer = null;

      const check = () => {
        try {
          const match = findElementByText(text);
          if (appear) {
            if (match) {
              const ref = ensureRefForElement(match);
              const center = centerOf(match);
              done({ success: true, matched: { ref, center }, tookMs: Date.now() - start });
            }
          } else {
            // wait for disappearance
            if (!match) {
              done({ success: true, matched: null, tookMs: Date.now() - start });
            }
          }
        } catch {}
      };

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        if (stopWatching) stopWatching();
        clearTimeout(timer);
        resolve(result);
      };

      // Initial check
      stopWatching = watchForChanges(check);
      check();
      timer = setTimeout(
        () => {
          done({ success: false, reason: 'timeout', tookMs: Date.now() - start });
        },
        Math.max(0, timeout),
      );
    });
  }

  function waitForSelector({ selector, visible = true, timeout = 5000, isXPath = false }) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;
      let stopWatching = null;
      let timer = null;

      const isMatch = () => {
        if (visible) return queryVisibleElement(selector, isXPath);
        return hasVisibleElement(selector, isXPath) ? null : 'hidden';
      };

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        if (stopWatching) stopWatching();
        clearTimeout(timer);
        resolve(result);
      };

      const check = () => {
        const el = isMatch();
        if (el === 'hidden') {
          done({ success: true, matched: null, tookMs: Date.now() - start });
          return;
        }
        if (el) {
          const ref = ensureRefForElement(el);
          const center = centerOf(el);
          done({ success: true, matched: { ref, center }, tookMs: Date.now() - start });
        }
      };

      // initial check
      stopWatching = watchForChanges(check);
      check();
      timer = setTimeout(
        () => done({ success: false, reason: 'timeout', tookMs: Date.now() - start }),
        Math.max(0, timeout),
      );
    });
  }

  function waitForClickable({ selector, ref, timeout = 5000, isXPath = false }) {
    return new Promise((resolve) => {
      const start = Date.now();
      let resolved = false;
      let stopWatching = null;
      let timer = null;

      const getElement = () => {
        if (ref) return resolveRef(ref);
        return queryClickableElement(selector, isXPath);
      };

      const done = (result) => {
        if (resolved) return;
        resolved = true;
        if (stopWatching) stopWatching();
        clearTimeout(timer);
        resolve(result);
      };

      const check = () => {
        const el = getElement();
        if (!el || !isClickable(el)) return;
        const ensuredRef = ensureRefForElement(el);
        const center = centerOf(el);
        done({ success: true, matched: { ref: ensuredRef, center }, tookMs: Date.now() - start });
      };

      stopWatching = watchForChanges(check);
      check();
      timer = setTimeout(
        () => done({ success: false, reason: 'timeout', tookMs: Date.now() - start }),
        Math.max(0, timeout),
      );
    });
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (request && request.action === 'wait_helper_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (request && request.action === 'waitForText') {
        const text = String(request.text || '').trim();
        const appear = request.appear !== false; // default true
        const timeout = Number(request.timeout || 5000);
        if (!text) {
          sendResponse({ success: false, error: 'text is required' });
          return true;
        }
        waitFor({ text, appear, timeout }).then((res) => sendResponse(res));
        return true; // async
      }
      if (request && request.action === 'waitForSelector') {
        const selector = String(request.selector || '').trim();
        const visible = request.visible !== false; // default true
        const timeout = Number(request.timeout || 5000);
        const isXPath = request.isXPath === true;
        if (!selector) {
          sendResponse({ success: false, error: 'selector is required' });
          return true;
        }
        waitForSelector({ selector, visible, timeout, isXPath }).then((res) => sendResponse(res));
        return true; // async
      }
      if (request && request.action === 'waitForClickable') {
        const selector = String(request.selector || '').trim();
        const ref = String(request.ref || '').trim();
        const timeout = Number(request.timeout || 5000);
        const isXPath = request.isXPath === true;
        if (!selector && !ref) {
          sendResponse({ success: false, error: 'selector or ref is required' });
          return true;
        }
        waitForClickable({ selector, ref, timeout, isXPath }).then((res) => sendResponse(res));
        return true; // async
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      return true;
    }
    return false;
  });
})();
