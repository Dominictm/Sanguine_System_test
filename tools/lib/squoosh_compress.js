'use strict';
// Сжатие PNG через squoosh.app (headless Chrome + CDP, без Puppeteer — его нет
// в проекте). Кодек WebP, Quality 90, результат сохраняется под тем же именем
// и расширением .png (см. .claude/skills/run-sanguine-web для общего рецепта
// CDP-автоматизации в этом репозитории).
//
// Используется из generate_library_art.js сразу после resizeTo400(), чтобы
// сгенерированные иллюстрации сразу ложились в web/public/img/... уменьшенными.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CHROME_PATH = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SQUOOSH_URL = 'https://squoosh.app/';
const WEBP_QUALITY = 90;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launchChrome(port, userDataDir) {
  const proc = spawn(CHROME_PATH, [
    '--headless=new', '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    SQUOOSH_URL,
  ], { stdio: 'ignore', detached: true });
  proc.unref();
  // подождать поднятия CDP-эндпоинта
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try {
      const r = await fetch(`http://localhost:${port}/json/version`);
      if (r.ok) return proc;
    } catch { /* ещё не поднялся */ }
  }
  throw new Error('Chrome CDP не поднялся на порту ' + port);
}

async function getPageWsUrl(port) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`http://localhost:${port}/json`)).json();
    const page = list.find(t => t.type === 'page');
    if (page) return page.webSocketDebuggerUrl;
    await sleep(300);
  }
  throw new Error('Не нашёл page target в CDP-списке');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}

function send(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) { ws.removeEventListener('message', handler); resolve(msg.result); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression, awaitPromise = false) {
  const result = await send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise, timeout: 20000 });
  if (result?.exceptionDetails) throw new Error('Squoosh page error: ' + JSON.stringify(result.exceptionDetails));
  return result?.result?.value;
}

async function waitForCodecSelectReady(ws, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const ready = await evaluate(ws, `document.querySelectorAll('select').length >= 2`);
    if (ready) return;
    await sleep(400);
  }
  throw new Error('Squoosh не показал панель настроек кодека (не загрузилось изображение?)');
}

async function waitForWebpBlob(ws, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const href = await evaluate(ws, `
      (() => {
        const a = document.querySelector('a[download$=".webp"]');
        return a ? a.href : null;
      })()
    `);
    if (href && href.startsWith('blob:')) return href;
    await sleep(400);
  }
  if (process.env.SQUOOSH_DEBUG) {
    console.error('DEBUG bodyText:', await evaluate(ws, 'document.body.innerText.slice(0,1500)'));
  }
  throw new Error('Squoosh не выдал результат WebP за отведённое время');
}

/**
 * Прогоняет один PNG через squoosh.app (кодек WebP, Quality 90) и
 * перезаписывает файл сжатыми байтами (расширение .png сохраняется).
 * @param {string} pngPath абсолютный путь к PNG-файлу для сжатия на месте
 */
async function compressPngViaSquoosh(pngPath) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const userDataDir = path.join(os.tmpdir(), 'squoosh-cdp-' + process.pid + '-' + port);
  fs.mkdirSync(userDataDir, { recursive: true });

  await launchChrome(port, userDataDir);
  const wsUrl = await getPageWsUrl(port);
  const ws = await connect(wsUrl);
  try {
    await send(ws, 'Page.enable');
    await send(ws, 'Runtime.enable');
    await send(ws, 'DOM.enable');

    const loadStart = Date.now();
    while (Date.now() - loadStart < 15000) {
      if (await evaluate(ws, `document.readyState === 'complete' && !!document.querySelector('input[type=file]')`)) break;
      await sleep(300);
    }

    const doc = await send(ws, 'DOM.getDocument', { depth: -1, pierce: true });
    const inputNode = await send(ws, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });

    // Изредка squoosh не успевает декодировать картинку с первой попытки
    // ("Source decoding error") — переустановка файла обычно чинит это.
    let decoded = false;
    for (let attempt = 1; attempt <= 3 && !decoded; attempt++) {
      await send(ws, 'DOM.setFileInputFiles', { files: [pngPath], nodeId: inputNode.nodeId });
      await waitForCodecSelectReady(ws);
      await sleep(1000);
      const hasError = await evaluate(ws, `document.body.innerText.includes('decoding error')`);
      if (!hasError) { decoded = true; break; }
      if (process.env.SQUOOSH_DEBUG) console.error(`  (squoosh: decode error, retry ${attempt}/3)`);
      await sleep(800);
    }
    if (!decoded) throw new Error('Squoosh не смог декодировать исходное изображение (3 попытки): ' + pngPath);

    await evaluate(ws, `
      (() => {
        const sel = document.querySelectorAll('select')[1];
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'webP');
        sel.dispatchEvent(new Event('change', {bubbles:true}));
      })()
    `);

    const qStart = Date.now();
    while (Date.now() - qStart < 10000) {
      if (await evaluate(ws, `!!document.querySelector('input[name="quality"]')`)) break;
      await sleep(300);
    }

    await evaluate(ws, `
      (() => {
        const el = document.querySelector('input[name="quality"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '${WEBP_QUALITY}');
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
      })()
    `);
    await sleep(2000);

    await waitForWebpBlob(ws);

    const b64 = await evaluate(ws, `
      (async () => {
        const a = document.querySelector('a[download$=".webp"]');
        const resp = await fetch(a.href);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      })()
    `, true);

    const compressed = Buffer.from(b64, 'base64');
    if (compressed.length < 100) throw new Error('Squoosh вернул подозрительно маленький результат: ' + compressed.length + ' байт');

    const originalSize = fs.statSync(pngPath).size;
    fs.writeFileSync(pngPath, compressed);
    return { originalSize, compressedSize: compressed.length };
  } finally {
    await send(ws, 'Browser.close').catch(() => {});
    await sleep(500);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (cleanupErr) {
      console.warn('  (squoosh: не удалось убрать временный профиль хрома, не критично)', cleanupErr.message);
    }
  }
}

module.exports = { compressPngViaSquoosh };
