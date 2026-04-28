import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const helperPath = resolve(process.cwd(), 'inject-scripts/accessibility-tree-helper.js');
const helperSource = readFileSync(helperPath, 'utf8');

type HelperListener = (
  request: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
) => boolean | void;

function markVisible(el: Element) {
  Object.defineProperty(el, 'offsetWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    value: 30,
  });
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 120,
      bottom: 30,
      width: 120,
      height: 30,
      toJSON() {
        return {};
      },
    }),
  });
}

function loadHelper(): HelperListener {
  let listener: HelperListener | undefined;

  delete (window as any).__ACCESSIBILITY_TREE_HELPER_INITIALIZED__;
  (window as any).__claudeElementMap = {};
  (window as any).__claudeRefCounter = 0;
  document.body.innerHTML = '';

  (chrome.runtime.onMessage.addListener as any) = vi.fn((cb: HelperListener) => {
    listener = cb;
  });

  window.eval(helperSource);

  if (!listener) {
    throw new Error('accessibility-tree-helper listener was not registered');
  }

  return listener;
}

function sendRequest(listener: HelperListener, request: any): Promise<any> {
  return new Promise((resolve) => {
    const returned = listener(request, {} as chrome.runtime.MessageSender, resolve);
    if (returned === false) resolve(undefined);
  });
}

describe('accessibility-tree helper DOM queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('queries hidden and shadow-dom elements in one structured list', async () => {
    const listener = loadHelper();

    const hiddenInput = document.createElement('input');
    hiddenInput.className = 'field';
    hiddenInput.type = 'hidden';
    hiddenInput.value = 'secret';
    document.body.appendChild(hiddenInput);

    const host = document.createElement('shadow-host');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadowButton.className = 'field';
    shadowButton.textContent = 'Pay now';
    markVisible(shadowButton);
    shadowRoot.appendChild(shadowButton);
    document.body.appendChild(host);

    const response = await sendRequest(listener, {
      action: 'queryElements',
      selector: '.field',
      includeHidden: true,
      limit: 10,
    });

    expect(response).toMatchObject({
      success: true,
      totalMatches: 2,
      truncated: false,
    });
    expect(response.elements).toHaveLength(2);
    expect(response.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: 'input',
          visible: false,
          enabled: true,
        }),
        expect.objectContaining({
          tagName: 'button',
          visible: true,
          text: 'Pay now',
        }),
      ]),
    );
  });

  it('returns outerHTML for a selector match', async () => {
    const listener = loadHelper();

    const hiddenInput = document.createElement('input');
    hiddenInput.className = 'field';
    hiddenInput.type = 'hidden';
    hiddenInput.setAttribute('data-testid', 'secret-field');
    document.body.appendChild(hiddenInput);
    const html = await sendRequest(listener, {
      action: 'getElementHtml',
      selector: '[data-testid="secret-field"]',
      includeOuterHtml: true,
      maxLength: 1000,
    });

    expect(html).toMatchObject({
      success: true,
      element: expect.objectContaining({
        ref: expect.any(String),
        tagName: 'input',
        html: expect.stringContaining('data-testid="secret-field"'),
        htmlLength: expect.any(Number),
        truncated: false,
      }),
    });
  });
});
