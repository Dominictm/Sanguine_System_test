const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { spawn } = require('child_process');

const app  = express();
const PORT = 3000;
const ROOT = path.join(__dirname, '..');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    if (k === 'Статус')       c.status       = v;
    if (k === 'Линейка WoD')  c.lineageLabel = v;
    if (k === 'Роль')         c.role         = v;
    if (k === 'Год обращения') c.embraceYear = v;
    if (k === 'Сир')          c.sire         = v;
    if (k === 'Год рождения') c.birthYear    = v;
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
  c.statusType = sl.includes('активен') || sl.includes('активна') ? 'active'
    : sl.includes('торпор') ? 'torpor'
    : (sl.includes('погиб') || sl.includes('уничтожен') || sl.includes('убит')) ? 'dead'
    : 'unknown';

  return c;
}

const LINEAGE_MAP = {
  vampires: 'vampire', fairies: 'fairy', mortals: 'mortal',
  werewolves: 'werewolf', mages: 'mage', hunters: 'hunter'
};

async function getAllCharacters() {
  const result = [];
  for (const [folder, lineage] of Object.entries(LINEAGE_MAP)) {
    const dir = path.join(ROOT, 'characters', folder);
    let entries;
    try { entries = await fs.readdir(dir); } catch { continue; }

    for (const entry of entries) {
      if (entry === '.gitkeep') continue;
      const mdPath = path.join(dir, entry, `${entry}.md`);
      try {
        const content = await fs.readFile(mdPath, 'utf-8');
        result.push(parseCharacter(content, entry, lineage));
      } catch { /* skip */ }
    }
  }
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
      openThreads = (ot.match(/^## /gm) || []).length;
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
      openThreads
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

    // Fuzzy-match a relationship target to a known node id
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

// Run a PowerShell tool
app.post('/api/run-tool', (req, res) => {
  const { tool, params = {} } = req.body;
  const allowed = ['new_city','new_npc','new_module','validate_links','status','search'];
  if (!allowed.includes(tool)) return res.status(400).json({ error: 'Unknown tool' });

  const script = path.join(ROOT, 'tools', `${tool}.ps1`);

  // Build param string — single-quoted values so Cyrillic passes correctly
  const paramStr = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `-${k} '${String(v).replace(/'/g, "''")}'`)
    .join(' ');

  // Force UTF-8 output BEFORE calling the script — fixes Russian garbling on CP866/CP1251 systems
  const cmd = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    `& '${script.replace(/\\/g, '\\\\').replace(/'/g, "''")}' ${paramStr}`
  ].join('; ');

  const args = ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', cmd];

  // Stdin answers for interactive prompts
  const stdinMap = {
    new_city:   `${params.Districts || ''}\nд\n`,
    new_npc:    `д\n`,
    new_module: `\n\n\nд\n`,
  };
  const stdinData = stdinMap[tool] || '';

  const ps = spawn('powershell.exe', args, {
    cwd: ROOT,
    env: { ...process.env, POWERSHELL_TELEMETRY_OPTOUT: '1' }
  });

  let out = '', err = '';
  if (stdinData) { ps.stdin.write(stdinData); ps.stdin.end(); }
  ps.stdout.on('data', d => { out += d.toString('utf8'); });
  ps.stderr.on('data', d => { err += d.toString('utf8'); });

  const timer = setTimeout(() => { ps.kill(); }, 30000);

  ps.on('close', code => {
    clearTimeout(timer);
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
});
