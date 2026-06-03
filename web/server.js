const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { spawn } = require('child_process');

const app  = express();
const PORT = 3000;
const ROOT = path.join(__dirname, '..');

let _cache = { chars: null, ts: 0 };
const CHARS_TTL = 15_000;

// Last known broken-link count from validate_links.ps1.
// null = never validated; 0 = clean; N = N broken links remaining.
let _brokenLinks = null;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/char-img', express.static(path.join(ROOT, 'characters')));

// ── Markdown parser ───────────────────────────────────────────────────────────

function categorizeRel(desc) {
  const d = desc.toLowerCase();
  if (/сестр|брат|мать|отец|семь|родств|племян/.test(d)) return 'family';
  if (/сир|создал|обратил|обратила/.test(d))              return 'sire';
  if (/чайлд|потомок/.test(d))                            return 'childe';
  if (/враг|ненавид|угроз|конфликт|противн/.test(d))      return 'enemy';
  if (/союзник|друг|доверя|помощ|поддерж/.test(d))        return 'ally';
  if (/любов|романт|привязан|влюбл/.test(d))              return 'romantic';
  if (/подозр|осторожн|насторож/.test(d))                 return 'suspicious';
  if (/лояльн|предан|служ|свита/.test(d))                 return 'loyalty';
  return 'neutral';
}

function parseCharacter(rawContent, folderName, lineage) {
  const content = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const c = { name: folderName, lineage, relationships: [] };

  // Name from # header (strip leading emoji / whitespace)
  const hm = content.match(/^#\s+[^\wЀ-ӿ]*([\wЀ-ӿ].+)$/m);
  if (hm) c.name = hm[1].trim();

  // Key-value fields:  - **Поле:** Значение
  const fRe = /^- \*\*([^*:\n]+):\*\*\s*(.+)$/gm;
  let m;
  while ((m = fRe.exec(content)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (k === 'Клан')         c.clan         = v;
    if (k === 'Секта')        c.sect         = v;
    if (k === 'Поколение')    c.generation   = v;
    if (k === 'Статус')         c.status        = v;
    if (k === 'Детали статуса') c.statusDetails = v;
    if (k === 'Линейка WoD')  c.lineageLabel = v;
    if (k === 'Роль')         c.role         = v;
    if (k === 'Год обращения') c.embraceYear = v;
    if (k === 'Сир')          c.sire         = v;
    if (k === 'Год рождения') c.birthYear    = v;
    if (k === 'Биография')    c.biography    = v;
    if (k === 'Голос')        c.voice        = v;
  }

  // Relationships section (indented sub-bullets after **Отношения:**)
  const relBlock = content.match(/- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/);
  if (relBlock) {
    const lines = relBlock[1].split('\n').filter(l => /^\s+-/.test(l));
    for (const line of lines) {
      const clean = line.trim().replace(/^-\s*/, '');
      const dash  = clean.indexOf(' — ');
      if (dash === -1) continue;
      const targets = clean.slice(0, dash).split(',').map(t => t.trim()).filter(Boolean);
      const desc    = clean.slice(dash + 3).trim();
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, type: categorizeRel(desc) });
      }
    }
  }

  // Lineage normalisation
  if (!c.lineage) {
    const ll = (c.lineageLabel || '').toLowerCase();
    if      (ll.includes('вампир'))                     c.lineage = 'vampire';
    else if (ll.includes('фея') || ll.includes('ченджлинг')) c.lineage = 'fairy';
    else if (ll.includes('смертн') || ll.includes('человек')) c.lineage = 'mortal';
    else if (ll.includes('оборот'))                     c.lineage = 'werewolf';
    else if (ll.includes('маг'))                        c.lineage = 'mage';
    else if (ll.includes('охотник'))                    c.lineage = 'hunter';
    else                                                c.lineage = 'unknown';
  }

  // Status type
  const sl = (c.status || '').toLowerCase();
  c.statusType = (sl.includes('жив') || sl.includes('жива') || sl.includes('активен') || sl.includes('активна')) ? 'active'
    : sl.includes('торпор') ? 'torpor'
    : (sl.includes('мёртв') || sl.includes('мертва') || sl.includes('погиб') || sl.includes('уничтожен') || sl.includes('убит')) ? 'dead'
    : sl.includes('неизвестно') ? 'unknown'
    : 'unknown';

  return c;
}

const LINEAGE_MAP = {
  vampires: 'vampire', fairies: 'fairy', mortals: 'mortal',
  werewolves: 'werewolf', mages: 'mage', hunters: 'hunter'
};

async function getAllCharacters() {
  if (_cache.chars && Date.now() - _cache.ts < CHARS_TTL) return _cache.chars;
  const result = [];
  for (const [folder, lineage] of Object.entries(LINEAGE_MAP)) {
    const dir = path.join(ROOT, 'characters', folder);
    let entries;
    try { entries = await fs.readdir(dir); } catch { continue; }

    for (const entry of entries) {
      if (entry === '.gitkeep') continue;
      const charDir = path.join(dir, entry);
      const mdPath  = path.join(charDir, `${entry}.md`);
      try {
        const content = await fs.readFile(mdPath, 'utf-8');
        const char = parseCharacter(content, entry, lineage);

        // Find first image in character folder
        const files = await fs.readdir(charDir).catch(() => []);
        const imgFile = files.find(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f));
        if (imgFile) {
          char.imageUrl = `/char-img/${folder}/${encodeURIComponent(entry)}/${encodeURIComponent(imgFile)}`;
        }

        result.push(char);
      } catch { /* skip */ }
    }
  }
  _cache = { chars: result, ts: Date.now() };
  return result;
}

async function countMdFiles(dir) {
  let n = 0;
  try {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) n += await countMdFiles(path.join(dir, item.name));
      else if (item.name.endsWith('.md') && item.name !== 'characters_ALL.md') n++;
    }
  } catch {}
  return n;
}

// ── Background validation ─────────────────────────────────────────────────────

// Run validate_links.ps1 silently; store exit code as brokenLinks count.
// Called automatically after tools that modify project files.
function runValidationBackground() {
  const script = path.join(ROOT, 'tools', 'validate_links.ps1');
  const cmd = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    `& '${script.replace(/\\/g, '\\\\').replace(/'/g, "''")}' -Force`
  ].join('; ');
  const ps = spawn('powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd],
    { cwd: ROOT, env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });
  ps.stdout.resume();
  ps.stderr.resume();
  ps.on('close', code => { _brokenLinks = code; });
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/status', async (req, res) => {
  try {
    const chars = await getAllCharacters();

    let modules = 0;
    try {
      const mods = await fs.readdir(path.join(ROOT, 'modules'));
      modules = mods.filter(m => m !== '.gitkeep' && !m.startsWith('.')).length;
    } catch {}

    let locations = 0;
    try { locations = await countMdFiles(path.join(ROOT, 'locations')); } catch {}

    let openThreads = 0;
    try {
      const ot = await fs.readFile(path.join(ROOT, 'rules', 'open_threads.md'), 'utf-8');
      openThreads = (ot.match(/^\| \d+\s*\|/gm) || []).length;
    } catch {}

    let domain = 'Домен не настроен';
    try {
      const cl = await fs.readFile(path.join(ROOT, 'CLAUDE.md'), 'utf-8');
      const dm = cl.match(/# Рассказчик: Vampire: The Masquerade — ([^,\n]+),\s*([^\n]+)/);
      if (dm) domain = `${dm[1].trim()}, ${dm[2].trim()}`;
    } catch {}

    res.json({
      domain,
      characters: chars.length,
      vampires:   chars.filter(c => c.lineage === 'vampire').length,
      fairies:    chars.filter(c => c.lineage === 'fairy').length,
      mortals:    chars.filter(c => c.lineage === 'mortal').length,
      werewolves: chars.filter(c => c.lineage === 'werewolf').length,
      mages:      chars.filter(c => c.lineage === 'mage').length,
      hunters:    chars.filter(c => c.lineage === 'hunter').length,
      active:     chars.filter(c => c.statusType === 'active').length,
      torpor:     chars.filter(c => c.statusType === 'torpor').length,
      modules,
      locations,
      openThreads,
      brokenLinks: _brokenLinks   // null = never validated, 0 = clean, N = broken
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/characters', async (req, res) => {
  try { res.json(await getAllCharacters()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/graph', async (req, res) => {
  try {
    const chars = await getAllCharacters();
    const nodes = chars.map(c => ({
      id: c.name, lineage: c.lineage,
      clan: c.clan || '', status: c.statusType, generation: c.generation || null
    }));

    const idSet = new Set(nodes.map(n => n.id));

    function resolveTarget(tgt) {
      if (idSet.has(tgt)) return tgt;
      for (const id of idSet) {
        const tl = tgt.toLowerCase(), il = id.toLowerCase();
        if (il.startsWith(tl) || tl.startsWith(il.split(' ')[0])) return id;
      }
      return null;
    }

    const links = [];
    const seen  = new Set();
    for (const c of chars) {
      for (const r of c.relationships) {
        const tgt = resolveTarget(r.target);
        if (!tgt || tgt === c.name) continue;
        const key = [c.name, tgt].sort().join('\x00');
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: c.name, target: tgt, type: r.type,
                     label: r.description.split(';')[0].slice(0, 55),
                     fromChar: c.name, description: r.description });
      }
    }

    res.json({ nodes, links });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/modules', async (req, res) => {
  try {
    const modsDir = path.join(ROOT, 'modules');
    const entries = await fs.readdir(modsDir, { withFileTypes: true });
    const mods = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const mod = { name: e.name, title: e.name };
      try {
        // Main module file is not named after the folder — find it among root .md files
        const allFiles = await fs.readdir(path.join(modsDir, e.name), { withFileTypes: true });
        const mainFile = allFiles.find(f =>
          f.isFile() && f.name.endsWith('.md') &&
          f.name !== 'нпс.md' && !f.name.endsWith('-лист.md'));
        if (!mainFile) continue;
        const content = await fs.readFile(
          path.join(modsDir, e.name, mainFile.name), 'utf-8');
        const hm = content.match(/^#\s+(.+)$/m);
        if (hm) mod.title = hm[1].replace(/[*[\]]/g, '').trim();
        for (const [label, key] of [['Тип','type'],['Формат','format'],['Время','time'],['Тон','tone']]) {
          const fm = content.match(new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*([^|\\n]+)\\|`));
          if (fm) mod[key] = fm[1].trim();
        }
      } catch {}
      mods.push(mod);
    }
    res.json(mods);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/threads', async (req, res) => {
  try {
    const content = await fs.readFile(
      path.join(ROOT, 'rules', 'open_threads.md'), 'utf-8');
    const threads = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^\|\s*(\d+)\s*\|\s*\*\*([^*]+)\*\*(.*?)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
      if (!m) continue;
      const sc = m[5].trim();
      threads.push({
        id:          parseInt(m[1]),
        title:       m[2].trim(),
        description: m[3].replace(/^[\s—\-]+/, '').trim(),
        source:      m[4].trim(),
        status:      sc.includes('🔴') ? 'active' : sc.includes('🟡') ? 'background' : sc.includes('🟢') ? 'closed' : 'unknown',
        priority:    m[6].replace(/\|?\s*$/, '').trim()
      });
    }
    res.json(threads);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Run a PowerShell tool ─────────────────────────────────────────────────────

// Switch params: passed as bare flags (-Name) without a value string.
// List them here so they aren't quoted as strings in the PS command.
const SWITCH_PARAMS = ['Fix'];

// Tools that write project files → trigger background revalidation on success.
const FILE_MUTATING_TOOLS = new Set(['new_npc', 'new_module', 'new_city']);

app.post('/api/run-tool', async (req, res) => {
  const { tool, params = {} } = req.body;
  const allowed = ['new_city','new_npc','new_module','validate_links','status','search'];
  if (!allowed.includes(tool)) return res.status(400).json({ error: 'Unknown tool' });

  const script = path.join(ROOT, 'tools', `${tool}.ps1`);

  // -Force skips interactive Read-Host / ReadKey for all interactive tools
  const forceFlag = ['new_city', 'new_npc', 'new_module', 'validate_links'].includes(tool)
    ? '-Force' : '';

  // Regular params (-Key 'Value')
  const regularParamStr = Object.entries(params)
    .filter(([k, v]) => !SWITCH_PARAMS.includes(k) && v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `-${k} '${String(v).replace(/'/g, "''")}'`)
    .join(' ');

  // Switch params (-Key with no value)
  const switchParamStr = SWITCH_PARAMS
    .filter(k => params[k] === true || params[k] === 'true')
    .map(k => `-${k}`)
    .join(' ');

  const allArgs = [regularParamStr, forceFlag, switchParamStr].filter(Boolean).join(' ');

  const cmd = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    `& '${script.replace(/\\/g, '\\\\').replace(/'/g, "''")}' ${allArgs}`
  ].join('; ');

  const ps = spawn('powershell.exe',
    ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd],
    { cwd: ROOT, env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' } });

  ps.stdin.end();
  let out = '', err = '';
  ps.stdout.on('data', d => { out += d.toString('utf8'); });
  ps.stderr.on('data', d => { err += d.toString('utf8'); });

  const timer = setTimeout(() => { ps.kill(); }, 30000);

  ps.on('close', code => {
    clearTimeout(timer);
    if (code === 0) {
      _cache = { chars: null, ts: 0 };
      if (FILE_MUTATING_TOOLS.has(tool)) runValidationBackground();
    }
    // For validate_links the exit code IS the broken link count
    if (tool === 'validate_links') _brokenLinks = code;
    res.json({ success: code === 0, output: out || err, exitCode: code });
  });
  ps.on('error', e => {
    clearTimeout(timer);
    res.json({ success: false, output: e.message, exitCode: -1 });
  });
});

app.listen(PORT, () => {
  console.log(`\n  \u{1F9DB} VTM Chronicle Manager`);
  console.log(`  ───────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
  // Run initial validation on startup
  runValidationBackground();
});
