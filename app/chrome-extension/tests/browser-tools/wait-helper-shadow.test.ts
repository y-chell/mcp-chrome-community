import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const waitHelperPath = resolve(process.cwd(), 'inject-scripts/wait-helper.js');
const waitHelperSource = readFileSync(waitHelperPath, 'utf8');

type WaitHelperListener = (
  request: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
) => boolean | void;

function markVisible(el: Element) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 120,
      bottom: 40,
      width: 120,
      height: 40,
      toJSON() {
        return {};
      },
    }),
  });
}

function loadWaitHelper(): WaitHelperListener {
  let listener: WaitHelperListener | undefined;

  delete (window as any).__WAIT_HELPER_INITIALIZED__;
  (window as any).__claudeElementMap = {};
  (window as any).__claudeRefCounter = 0;
  document.body.innerHTML = '';

  (chrome.runtime.onMessage.addListener as any) = vi.fn((cb: WaitHelperListener) => {
    listener = cb;
  });

  window.eval(waitHelperSource);

  if (!listener) {
    throw new Error('wait-helper listener was not registered');
  }

  return listener;
}

function sendWaitRequest(listener: WaitHelperListener, request: any): Promise<any> {
  return new Promise((resolve) => {
    const returned = listener(request, {} as chrome.runtime.MessageSender, resolve);
    if (returned === false) {
      resolve(undefined);
    }
  });
}

describe('wait-helper shadow dom support', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('finds selector matches inside open shadow roots', async () => {
    const listener = loadWaitHelper();
    const host = document.createElement('shadow-host');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.className = 'shadow-button';
    button.textContent = 'Pay now';
    markVisible(button);
    shadowRoot.appendChild(button);
    document.body.appendChild(host);

    const response = await sendWaitRequest(listener, {
      action: 'waitForSelector',
      selector: '.shadow-button',
      timeout: 80,
    });

    expect(response).toMatchObject({
      success: true,
      matched: {
        ref: expect.any(String),
        center: { x: 60, y: 20 },
      },
    });
  });

  it('finds text matches inside open shadow roots', async () => {
    const listener = loadWaitHelper();
    const host = document.createElement('text-host');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const label = document.createElement('span');
    label.textContent = 'Shadow Ready';
    markVisible(label);
    shadowRoot.appendChild(label);
    document.body.appendChild(host);

    const response = await sendWaitRequest(listener, {
      action: 'waitForText',
      text: 'Shadow Ready',
      timeout: 80,
    });

    expect(response?.success).toBe(true);
    expect(response?.matched?.ref).toBeTruthy();
  });

  it('waits for clickable elements inside shadow roots', async () => {
    const listener = loadWaitHelper();
    const host = document.createElement('click-host');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.className = 'delayed-shadow-button';
    button.setAttribute('disabled', '');
    button.textContent = 'Continue';
    markVisible(button);
    shadowRoot.appendChild(button);
    document.body.appendChild(host);

    setTimeout(() => button.removeAttribute('disabled'), 20);

    const response = await sendWaitRequest(listener, {
      action: 'waitForClickable',
      selector: '.delayed-shadow-button',
      timeout: 300,
    });

    expect(response).toMatchObject({
      success: true,
      matched: {
        ref: expect.any(String),
      },
    });
  });
});
