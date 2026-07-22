import { writeFile } from 'node:fs/promises'
import { BrowserWindow } from 'electron'

const MAX_PAGE_TEXT_CHARS = 20_000
const MAX_ELEMENTS = 100

function validateUrl(value) {
  const url = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Browser automation only supports http and https URLs.')
  return url.href
}

function validateSelector(value) {
  const selector = String(value || '').trim()
  if (!selector) throw new Error('A selector is required for this browser action.')
  if (selector.length > 500) throw new Error('Browser selector is limited to 500 characters.')
  return selector
}

function pageScript(operation, payload = {}) {
  return `(() => {
    const operation = ${JSON.stringify(operation)};
    const payload = ${JSON.stringify(payload)};
    const find = () => {
      const element = document.querySelector(payload.selector);
      if (!element) throw new Error('No element matches selector: ' + payload.selector);
      return element;
    };
    if (operation === 'inspect') {
      const selectorFor = (element) => {
        if (element.id) return '#' + CSS.escape(element.id);
        const name = element.getAttribute('name');
        if (name) return element.tagName.toLowerCase() + '[name=' + JSON.stringify(name) + ']';
        const testId = element.getAttribute('data-testid');
        if (testId) return '[data-testid=' + JSON.stringify(testId) + ']';
        const aria = element.getAttribute('aria-label');
        if (aria) return element.tagName.toLowerCase() + '[aria-label=' + JSON.stringify(aria) + ']';
        return element.tagName.toLowerCase();
      };
      const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        })
        .slice(0, ${MAX_ELEMENTS})
        .map((element) => ({
          selector: selectorFor(element),
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || '',
          text: String(element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
          href: element.href || '',
          type: element.getAttribute('type') || '',
          disabled: Boolean(element.disabled),
        }));
      return { title: document.title, url: location.href, text: String(document.body?.innerText || '').slice(0, ${MAX_PAGE_TEXT_CHARS}), elements };
    }
    if (operation === 'click') {
      const element = find();
      element.click();
      return { selector: payload.selector };
    }
    if (operation === 'type') {
      const element = find();
      element.focus();
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, payload.text);
      else element.value = payload.text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: payload.text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      if (payload.submit) element.form?.requestSubmit?.();
      return { selector: payload.selector, submitted: Boolean(payload.submit) };
    }
    return null;
  })()`
}

export function createElectronBrowserAutomationDriver() {
  const windows = new Map()

  const ensureWindow = (sessionId, viewport) => {
    let window = windows.get(sessionId)
    if (window && !window.isDestroyed()) {
      window.setContentSize(viewport.width, viewport.height)
      return window
    }
    window = new BrowserWindow({
      width: viewport.width,
      height: viewport.height,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        safeDialogs: true,
      },
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      void window.loadURL(validateUrl(url))
      return { action: 'deny' }
    })
    window.on('closed', () => windows.delete(sessionId))
    windows.set(sessionId, window)
    return window
  }

  const closeSession = async (sessionId) => {
    const window = windows.get(sessionId)
    if (!window) return false
    windows.delete(sessionId)
    if (!window.isDestroyed()) window.destroy()
    return true
  }

  return {
    async execute(sessionId, input, { signal, onProgress } = {}) {
      signal?.throwIfAborted?.()
      if (input.action === 'close') return { action: 'close', closed: await closeSession(sessionId) }
      const window = ensureWindow(sessionId, input.viewport)
      if (input.action === 'open') {
        const url = validateUrl(input.url)
        onProgress?.(`Opening ${url}`)
        await window.loadURL(url)
        if (input.waitMs) await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(15_000, input.waitMs)))
        return { action: 'open', url: window.webContents.getURL(), title: window.getTitle(), viewport: input.viewport }
      }
      if (!window.webContents.getURL()) throw new Error('Open a page before using browser actions.')
      if (input.action === 'inspect') {
        return { action: 'inspect', ...await window.webContents.executeJavaScript(pageScript('inspect'), true) }
      }
      if (input.action === 'click' || input.action === 'type') {
        const selector = validateSelector(input.selector)
        onProgress?.(`${input.action === 'click' ? 'Clicking' : 'Typing into'} ${selector}`)
        const result = await window.webContents.executeJavaScript(pageScript(input.action, { selector, text: String(input.text || '').slice(0, 5_000), submit: Boolean(input.submit) }), true)
        if (input.waitMs) await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(15_000, input.waitMs)))
        return { action: input.action, ...result, url: window.webContents.getURL(), title: window.getTitle() }
      }
      if (input.action === 'wait') {
        const waitMs = Math.min(15_000, Math.max(0, Number(input.waitMs) || 1_000))
        await new Promise((resolveWait) => setTimeout(resolveWait, waitMs))
        return { action: 'wait', waitMs, url: window.webContents.getURL(), title: window.getTitle() }
      }
      if (input.action === 'screenshot') {
        onProgress?.(`Capturing ${window.webContents.getURL()}`)
        const image = await window.webContents.capturePage()
        await writeFile(input.outputPath, image.toPNG())
        return {
          action: 'screenshot',
          path: input.outputPath,
          name: input.outputPath.split(/[\\/]/).at(-1),
          mimeType: 'image/png',
          url: window.webContents.getURL(),
          title: window.getTitle(),
          fullPage: false,
          viewport: input.viewport,
        }
      }
      throw new Error(`Unsupported browser action: ${input.action}`)
    },
    closeSession,
    async dispose() {
      await Promise.all([...windows.keys()].map((id) => closeSession(id)))
    },
  }
}
