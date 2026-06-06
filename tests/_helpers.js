'use strict';
/**
 * Общие помощники для автотестов VTM Chronicle Manager.
 *  - запуск/остановка сервера на отдельном порту с тестовым городом
 *  - HTTP-клиент к API
 *  - мини-фреймворк (suite/test/assert) + сводка + HTML-отчёт
 *  - slugify (как на сервере) и удаление тестового города
 */
const http  = require('http');
const path  = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');

const ROOT   = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'web', 'server.js');

// ── slugify: повторяет таблицу транслитерации сервера/инструментов ──────────────
const _TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const slugify = s => (s || '').toLowerCase().split('').map(c => _TR[c] !== undefined ? _TR[c] : c).join('')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');

// ── процесс сервера ─────────────────────────────────────────────────────────────
function startServer(port, env = {}) {
  const ps = spawn('node', [SERVER], {
    cwd: path.join(ROOT, 'web'),
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (process.env.VERBOSE) {
    ps.stdout.on('data', d => process.stdout.write('[srv] ' + d));
    ps.stderr.on('data', d => process.stderr.write('[srv:err] ' + d));
  } else {
    ps.stdout.on('data', () => {}); ps.stderr.on('data', () => {});
  }
  return ps;
}
function stopServer(ps) {
  return new Promise(resolve => {
    if (!ps || ps.killed) return resolve();
    ps.on('close', () => resolve());
    try { ps.kill(); } catch { resolve(); }
    setTimeout(resolve, 2000);
  });
}

// ── HTTP-клиент ────────────────────────────────────────────────────────────────
function request(method, urlPath, body, port) {
  return new Promise((resolve, reject) => {
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method,
        headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) } },
      res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          let json = null; try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, json, raw: buf });
        });
      });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const get  = (p, port)        => request('GET',  p, null, port);
const post = (p, body, port)  => request('POST', p, body, port);

async function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await get('/api/cities', port); if (r.status === 200) return true; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Сервер не поднялся на порту ${port} за ${timeoutMs} мс`);
}

// ── файловые помощники ───────────────────────────────────────────────────────────
const cityPath = slug => path.join(ROOT, 'cities', slug);
const exists   = rel => fs.existsSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel));
const readFile = rel => fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), 'utf-8');
function rmTestCity(slug) {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) return;
  try { fs.rmSync(cityPath(slug), { recursive: true, force: true }); } catch {}
}

// ── мини-фреймворк ────────────────────────────────────────────────────────────────
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
class Runner {
  constructor(title) { this.title = title; this.groups = []; this._g = null; this.pass = 0; this.fail = 0; }
  group(name) { this._g = { name, items: [] }; this.groups.push(this._g); console.log(`\n${C.b}▌ ${name}${C.x}`); }
  async test(name, fn) {
    if (!this._g) this.group('Тесты');
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      this.pass++; this._g.items.push({ name, ok: true, ms });
      console.log(`  ${C.g}✓${C.x} ${name} ${C.d}(${ms} мс)${C.x}`);
    } catch (e) {
      const ms = Date.now() - t0;
      this.fail++; this._g.items.push({ name, ok: false, ms, err: e.message });
      console.log(`  ${C.r}✗ ${name}${C.x}\n      ${C.r}${e.message}${C.x}`);
    }
  }
  summary() {
    const total = this.pass + this.fail;
    const ok = this.fail === 0;
    console.log(`\n${C.b}═══ ${this.title} ═══${C.x}`);
    console.log(`  Всего: ${total}   ${C.g}✓ ${this.pass}${C.x}   ${this.fail ? C.r : C.d}✗ ${this.fail}${C.x}`);
    console.log(ok ? `${C.g}${C.b}  ВСЁ ЗЕЛЁНОЕ${C.x}` : `${C.r}${C.b}  ЕСТЬ ПАДЕНИЯ${C.x}`);
    return ok;
  }
  writeReport(file) {
    const rows = this.groups.map(g => {
      const items = g.items.map(i =>
        `<tr class="${i.ok ? 'ok' : 'fail'}"><td>${i.ok ? '✓' : '✗'}</td><td>${esc(i.name)}</td>` +
        `<td class="ms">${i.ms} мс</td><td class="err">${i.err ? esc(i.err) : ''}</td></tr>`).join('');
      return `<tbody><tr class="grp"><td colspan="4">${esc(g.name)}</td></tr>${items}</tbody>`;
    }).join('');
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(this.title)}</title>
<style>
:root{--bg:#0a0a0a;--fg:#E8E0D0;--crim:#CC2200;--gold:#B8860B;--ok:#3a7d3a;--bad:#a02020}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 'Cormorant Garamond',Georgia,serif}
h1{font-family:'Cinzel',serif;letter-spacing:.12em;color:var(--gold);border-bottom:1px solid #3a1a1a;padding:24px 32px;margin:0}
.meta{padding:8px 32px;color:#9a8f7a}
table{width:calc(100% - 64px);margin:16px 32px;border-collapse:collapse;font-size:14px}
td{padding:6px 10px;border-bottom:1px solid #1c1410}
.grp td{background:#160d0a;color:var(--gold);font-family:'Cinzel',serif;letter-spacing:.08em;font-size:13px}
tr.ok td:first-child{color:var(--ok)} tr.fail td:first-child{color:var(--bad)}
tr.fail{background:#1a0c0c} .ms{color:#7a7062;text-align:right;white-space:nowrap} .err{color:#d98}
.tot{font-family:'Cinzel',serif;font-size:18px;padding:16px 32px}
.pass{color:var(--ok)} .failc{color:var(--bad)}
</style></head><body>
<h1>🩸 ${esc(this.title)}</h1>
<div class="meta">${new Date().toLocaleString('ru-RU')}</div>
<div class="tot"><span class="pass">✓ ${this.pass}</span> &nbsp; <span class="${this.fail ? 'failc' : ''}">✗ ${this.fail}</span> &nbsp; из ${this.pass + this.fail}</div>
<table>${rows}</table></body></html>`;
    fs.writeFileSync(file, html, 'utf-8');
    return file;
  }
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── ассерты ────────────────────────────────────────────────────────────────────
const assert = {
  ok(cond, msg)      { if (!cond) throw new Error(msg || 'ожидалось истинное значение'); },
  eq(a, b, msg)      { if (a !== b) throw new Error(msg || `ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); },
  ge(a, b, msg)      { if (!(a >= b)) throw new Error(msg || `ожидалось >= ${b}, получено ${a}`); },
  match(s, re, msg)  { if (!re.test(String(s))) throw new Error(msg || `строка не совпала с ${re}: «${String(s).slice(0, 120)}»`); },
  includes(arr, v, msg){ if (!arr.includes(v)) throw new Error(msg || `массив не содержит ${JSON.stringify(v)}`); },
  fileExists(rel, msg){ if (!exists(rel)) throw new Error(msg || `нет файла: ${rel}`); },
};

module.exports = {
  ROOT, SERVER, slugify, startServer, stopServer, request, get, post, waitForServer,
  cityPath, exists, readFile, rmTestCity, Runner, assert,
};
