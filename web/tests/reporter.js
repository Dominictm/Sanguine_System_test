'use strict';
/**
 * reporter.js — VTM test reporter
 *
 * Usage: node --test --test-reporter=./tests/reporter.js tests/all.test.js
 *
 * Console: coloured hierarchical summary.
 * File:    tests/report.html — dark gothic HTML report, opens in browser.
 */

const fs   = require('fs');
const path = require('path');

// ── ANSI palette ──────────────────────────────────────────────────────────────
const A = {
  r:  '\x1b[0m',   // reset
  b:  '\x1b[1m',   // bold
  d:  '\x1b[2m',   // dim
  g:  '\x1b[32m',  // green
  R:  '\x1b[31m',  // red
  y:  '\x1b[33m',  // yellow
  c:  '\x1b[36m',  // cyan
  w:  '\x1b[97m',  // bright white
};
const sp = n => '  '.repeat(Math.max(0, n));

// ── Tree builder ──────────────────────────────────────────────────────────────
// Events arrive preorder for test:start and postorder for test:pass/fail.
// We push placeholders at test:start time and finalise at test:pass/fail time.
function buildTree(events) {
  const root = { name: 'root', nesting: -1, children: [], isLeaf: false, passed: true, error: null, durMs: 0 };
  const stack = [root]; // stack[depth+1] = node at that nesting level

  for (const { type, data } of events) {
    if (!data) continue;
    const n = data.nesting ?? 0;

    if (type === 'test:start') {
      const node = {
        name: data.name, nesting: n,
        children: [], isLeaf: true, passed: true, error: null, durMs: 0,
      };
      const parent = stack[n] ?? root;
      parent.children.push(node);
      stack.length = n + 1; // truncate stale siblings
      stack.push(node);     // node now at stack[n+1]

    } else if (type === 'test:pass' || type === 'test:fail') {
      const node = stack[n + 1];
      if (node) {
        node.passed = type === 'test:pass';
        node.isLeaf = data.details?.type !== 'suite';
        node.error  = data.details?.error?.message ?? null;
        node.durMs  = data.details?.duration_ms ?? 0;
      }
      stack.length = n + 1; // pop
    }
  }
  return root;
}

// ── Tree helpers ──────────────────────────────────────────────────────────────
function collectLeaves(node, out = []) {
  if (node.isLeaf && node.name !== 'root') out.push(node);
  for (const c of node.children) collectLeaves(c, out);
  return out;
}

function suiteStats(node) {
  let p = 0, f = 0;
  for (const l of collectLeaves(node)) l.passed ? p++ : f++;
  return { p, f };
}

// ── Console renderer ──────────────────────────────────────────────────────────
function renderConsoleLines(node, depth, lines) {
  if (node.name === 'root') {
    for (const c of node.children) renderConsoleLines(c, 0, lines);
    return;
  }
  if (!node.isLeaf) {
    const col  = node.passed ? A.g : A.R;
    const glyph = depth === 0 ? '▸' : (depth === 1 ? '─' : '·');
    lines.push(`${sp(depth)}${col}${glyph}${A.r} ${A.b}${node.name}${A.r}`);
    for (const c of node.children) renderConsoleLines(c, depth + 1, lines);
    if (depth === 0) lines.push('');
  } else {
    const icon = node.passed ? `${A.g}✓${A.r}` : `${A.R}✗${A.r}`;
    const name = node.passed
      ? `${A.d}${node.name}${A.r}`
      : `${A.R}${A.b}${node.name}${A.r}`;
    lines.push(`${sp(depth)}${icon} ${name}`);
    if (!node.passed && node.error) {
      const msg = node.error.split('\n')[0].trim();
      if (msg) lines.push(`${sp(depth + 1)}${A.d}${msg}${A.r}`);
    }
  }
}

// ── HTML generator ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderHtmlNode(node) {
  if (node.name === 'root') {
    return node.children.map(renderHtmlNode).join('\n');
  }
  if (!node.isLeaf) {
    const { p, f } = suiteStats(node);
    const cls      = node.passed ? 'suite-pass' : 'suite-fail';
    const statHtml = f > 0
      ? `<span class="s-fail">${f}✗</span>&nbsp;<span class="s-pass">${p}✓</span>`
      : `<span class="s-pass">${p}✓</span>`;
    return `
<details class="suite ${cls}" open>
  <summary><span class="suite-name">${esc(node.name)}</span><span class="suite-stat">${statHtml}</span></summary>
  <div class="suite-body">${node.children.map(renderHtmlNode).join('\n')}</div>
</details>`;
  } else {
    const cls  = node.passed ? 'test-pass' : 'test-fail';
    const icon = node.passed ? '✓' : '✗';
    const errHtml = (!node.passed && node.error)
      ? `<pre class="test-error">${esc(node.error.split('\n').slice(0, 8).join('\n'))}</pre>` : '';
    return `<div class="test ${cls}"><span class="t-icon">${icon}</span><span class="t-name">${esc(node.name)}</span>${errHtml}</div>`;
  }
}

function buildHtml(root, pass, fail, dur) {
  const total      = pass + fail;
  const pct        = total > 0 ? Math.round(pass / total * 100) : 0;
  const statusCls  = fail > 0 ? 'bad' : 'good';
  const statusText = fail > 0 ? `${fail} FAILED` : 'ALL PASSED';
  const runDate    = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const body       = renderHtmlNode(root);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VTM Test Report</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=IM+Fell+English:ital@0;1&family=Source+Code+Pro:wght@400;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #080808;
    --bg2:      #111111;
    --bg3:      #1a1212;
    --border:   #2a1a1a;
    --border2:  #3d2020;
    --text:     #d8ccc0;
    --text-dim: #7a6a60;
    --crimson:  #8b0000;
    --blood:    #cc2200;
    --gold:     #b8860b;
    --gold2:    #d4a017;
    --green:    #2d7a2d;
    --green2:   #3a9a3a;
    --red:      #7a1a1a;
    --red2:     #aa2020;
  }

  html { scroll-behavior: smooth; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'IM Fell English', Georgia, serif;
    font-size: 15px;
    line-height: 1.6;
    min-height: 100vh;
  }

  /* ── Header ── */
  .report-header {
    background: linear-gradient(180deg, #140808 0%, var(--bg) 100%);
    border-bottom: 1px solid var(--border2);
    padding: 3rem 2rem 2rem;
    text-align: center;
    position: relative;
  }
  .report-header::before {
    content: '';
    position: absolute; inset: 0;
    background: repeating-linear-gradient(
      -45deg, transparent, transparent 8px,
      rgba(139,0,0,0.03) 8px, rgba(139,0,0,0.03) 16px
    );
  }
  .report-header h1 {
    font-family: 'Cinzel', serif;
    font-size: 2.2rem;
    font-weight: 700;
    color: var(--gold2);
    letter-spacing: .12em;
    text-shadow: 0 0 30px rgba(184,134,11,.4);
    position: relative;
  }
  .report-header .subtitle {
    font-family: 'Cinzel', serif;
    font-size: .85rem;
    letter-spacing: .2em;
    color: var(--text-dim);
    margin-top: .5rem;
    position: relative;
  }
  .status-badge {
    display: inline-block;
    margin-top: 1.2rem;
    padding: .35rem 1.4rem;
    font-family: 'Cinzel', serif;
    font-size: .9rem;
    letter-spacing: .15em;
    border: 1px solid;
    position: relative;
  }
  .status-badge.good { color: var(--green2); border-color: var(--green2); text-shadow: 0 0 10px var(--green); }
  .status-badge.bad  { color: var(--red2);   border-color: var(--red2);   text-shadow: 0 0 10px var(--red); }

  /* ── Summary bar ── */
  .summary-bar {
    display: flex;
    justify-content: center;
    gap: 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
  }
  .stat-box {
    padding: 1.2rem 2rem;
    text-align: center;
    border-right: 1px solid var(--border);
    min-width: 100px;
  }
  .stat-box:last-child { border-right: none; }
  .stat-box .val {
    display: block;
    font-family: 'Cinzel', serif;
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 1;
  }
  .stat-box .lbl {
    display: block;
    font-size: .65rem;
    letter-spacing: .2em;
    color: var(--text-dim);
    margin-top: .3rem;
    font-family: 'Cinzel', serif;
  }
  .stat-box.s-total .val { color: var(--gold); }
  .stat-box.s-pass  .val { color: var(--green2); }
  .stat-box.s-fail  .val { color: ${fail > 0 ? 'var(--red2)' : 'var(--text-dim)'}; }
  .stat-box.s-dur   .val { color: var(--text-dim); }
  .stat-box.s-pct   .val { color: var(--gold); }

  /* ── Progress bar ── */
  .progress-track {
    height: 3px;
    background: var(--border);
  }
  .progress-fill {
    height: 100%;
    width: ${pct}%;
    background: linear-gradient(90deg, var(--crimson), var(--blood));
    transition: width .6s ease;
  }

  /* ── Results ── */
  .results {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  /* ── Suite ── */
  details.suite {
    margin-bottom: 1rem;
    border: 1px solid var(--border);
    background: var(--bg2);
    border-radius: 2px;
  }
  details.suite-pass { border-left: 3px solid var(--green); }
  details.suite-fail { border-left: 3px solid var(--red2); }

  details.suite summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .65rem 1rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
    border-bottom: 1px solid transparent;
    transition: background .15s;
  }
  details.suite[open] summary { border-bottom-color: var(--border); }
  details.suite summary:hover { background: rgba(255,255,255,.03); }
  details.suite summary::-webkit-details-marker { display: none; }

  .suite-name {
    font-family: 'Cinzel', serif;
    font-size: .9rem;
    letter-spacing: .06em;
    color: var(--gold);
  }
  details.suite-fail .suite-name { color: var(--red2); }

  .suite-stat { font-size: .8rem; }
  .s-pass { color: var(--green2); }
  .s-fail { color: var(--red2); margin-right: .4rem; }

  .suite-body {
    padding: .5rem .5rem .5rem 1rem;
  }

  /* Nested suite */
  .suite-body details.suite {
    margin-bottom: .4rem;
    background: rgba(0,0,0,.25);
  }
  .suite-body .suite-name {
    font-size: .82rem;
    color: var(--text);
    letter-spacing: .04em;
  }

  /* ── Test rows ── */
  .test {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: .3rem;
    padding: .22rem .5rem;
    font-family: 'Source Code Pro', monospace;
    font-size: .8rem;
  }
  .test-pass .t-icon { color: var(--green2); }
  .test-fail .t-icon { color: var(--red2); font-weight: 600; }
  .test-pass .t-name { color: var(--text-dim); }
  .test-fail .t-name { color: var(--text); font-weight: 600; }

  .test-error {
    width: 100%;
    margin: .3rem 0 .3rem 1.2rem;
    padding: .5rem .75rem;
    background: rgba(139,0,0,.15);
    border-left: 2px solid var(--red2);
    font-size: .75rem;
    color: #c08080;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ── Footer ── */
  .report-footer {
    text-align: center;
    padding: 1.5rem;
    font-size: .72rem;
    letter-spacing: .15em;
    color: var(--text-dim);
    border-top: 1px solid var(--border);
    font-family: 'Cinzel', serif;
  }
  .report-footer span { color: var(--gold); }

  /* ── Scrollbar ── */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--crimson); border-radius: 3px; }
</style>
</head>
<body>

<div class="report-header">
  <h1>Vampire: The Masquerade</h1>
  <p class="subtitle">CHRONICLE MANAGER · TEST REPORT · ${esc(runDate)}</p>
  <span class="status-badge ${statusCls}">${statusText}</span>
</div>

<div class="summary-bar">
  <div class="stat-box s-total"><span class="val">${total}</span><span class="lbl">TOTAL</span></div>
  <div class="stat-box s-pass"> <span class="val">${pass}</span> <span class="lbl">PASSED</span></div>
  <div class="stat-box s-fail"> <span class="val">${fail}</span> <span class="lbl">FAILED</span></div>
  <div class="stat-box s-dur">  <span class="val">${dur}s</span><span class="lbl">DURATION</span></div>
  <div class="stat-box s-pct">  <span class="val">${pct}%</span><span class="lbl">PASS RATE</span></div>
</div>
<div class="progress-track"><div class="progress-fill"></div></div>

<div class="results">
  ${body}
</div>

<div class="report-footer">
  Generated by <span>VTM Chronicle Manager</span> test suite &mdash; ${esc(runDate)}
</div>

</body>
</html>`;
}

// ── Reporter entry point ──────────────────────────────────────────────────────
// Console output is handled by the built-in `spec` reporter (run in parallel).
// This reporter only builds the HTML file; destination should be `nul`/`/dev/null`.
module.exports = async function* reporter(source) {
  const t0 = Date.now();
  const allEvents = [];

  for await (const event of source) allEvents.push(event);

  const tree   = buildTree(allEvents);
  const leaves = collectLeaves(tree);
  const pass   = leaves.filter(l => l.passed).length;
  const fail   = leaves.filter(l => !l.passed).length;
  const dur    = ((Date.now() - t0) / 1000).toFixed(2);

  const htmlPath = path.join(__dirname, 'report.html');
  try {
    fs.writeFileSync(htmlPath, buildHtml(tree, pass, fail, dur));
  } catch (_) { /* non-fatal */ }
};
