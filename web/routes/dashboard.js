'use strict';
// Роутер дашборда: сводный статус, граф связей, глобальный поиск, проверки
// целостности. Простой `{ router }` — DI не нужен (только общее состояние
// _brokenLinks, живущее в lib/db.js — синхронизируется с runValidationBackground
// из server.js через getBrokenLinks/setBrokenLinks).
// Вынесено из server.js (E1.2d).

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError } = require('../lib/http');
const {
  cityDir, locsDir, archiveDir, reqCity, listCities,
  getAllCharacters, listModules, countMdFiles, readOpenThreadsRaw,
  aggregateEvents, makeNameResolver, getDiaryIndex, eventMonthKey,
  getBrokenLinks, getChronicleDisplay,
} = require('../lib/db');

const router = express.Router();

router.get('/api/status', async (req, res) => {
  try {
    const city  = reqCity(req);
    const chars = await getAllCharacters(city);

    let modules = 0;
    try { modules = (await listModules(city)).length; } catch {}

    let locations = 0;
    try { locations = await countMdFiles(locsDir(city)); } catch {}

    let openThreads = 0;   // только активные/фоновые (исключая 🟢 закрытые)
    try {
      openThreads = (await readOpenThreadsRaw(city)).split('\n')
        .filter(l => /^\| \d+\s*\|/.test(l) && !/🟢/.test(l)).length;
    } catch {}

    let events = 0;
    try { events = (await aggregateEvents(city)).length; } catch {}

    let domain = 'Домен не настроен';
    try {
      const cm = await fs.readFile(path.join(cityDir(city), 'city.md'), 'utf-8');
      const dm = cm.match(/^#\s+(.+?)\s*$/m);
      if (dm) domain = dm[1].replace(/\s*—\s*сеттинг города/i, '').trim();
    } catch {}

    res.json({
      domain,
      city,
      cities: await listCities(),
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
      events,
      brokenLinks: getBrokenLinks()   // null = never validated, 0 = clean, N = broken
    });
  } catch (e) { serverError(res, e); }
});

router.get('/api/graph', async (req, res) => {
  try {
    const chars = await getAllCharacters(reqCity(req));
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

    // ?compact=true — агрегация по линейке для больших городов: один узел на
    // линейку вместо одного на персонажа, чтобы D3-симуляция не захлёбывалась.
    if (String(req.query.compact) === 'true') {
      const nodeById = new Map(nodes.map(n => [n.id, n]));
      const counts   = new Map();
      for (const n of nodes) counts.set(n.lineage, (counts.get(n.lineage) || 0) + 1);

      const compactNodes = [...counts.entries()].map(([lineage, count]) => ({
        id: lineage, lineage, count,
      }));

      const edgeCounts = new Map(); // "lineageA\x00lineageB" → count
      for (const l of links) {
        const a = nodeById.get(l.source)?.lineage;
        const b = nodeById.get(l.target)?.lineage;
        if (!a || !b || a === b) continue;
        const key = [a, b].sort().join('\x00');
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
      const compactLinks = [...edgeCounts.entries()].map(([key, count]) => {
        const [a, b] = key.split('\x00');
        return { source: a, target: b, type: 'aggregate', count, label: `${count} связ.` };
      });

      return res.json({ nodes: compactNodes, links: compactLinks });
    }

    res.json({ nodes, links });
  } catch (e) { serverError(res, e); }
});

// ── Global search ──────────────────────────────────────────────────────────────
router.get('/api/search', async (req, res) => {
  try {
    const city = reqCity(req);
    const q = (req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 3) return res.json({ query: q, results: {}, total: 0 });

    const cityBase = cityDir(city);

    const mkExcerpt = (content, len = 160) => {
      const idx = content.toLowerCase().indexOf(q);
      if (idx < 0) return content.slice(0, len).replace(/\n/g, ' ');
      const start = Math.max(0, idx - 60);
      const end   = Math.min(content.length, idx + q.length + 100);
      return (start > 0 ? '…' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '…' : '');
    };

    const walkMd = async (dir, filterFn) => {
      const hits = [];
      const walk = async d => {
        let entries;
        try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { await walk(p); }
          else if (e.name.endsWith('.md')) {
            if (filterFn && !filterFn(p, e.name)) continue;
            let content;
            try { content = await fs.readFile(p, 'utf-8'); } catch { continue; }
            if (content.toLowerCase().includes(q)) hits.push({ path: p, content });
          }
        }
      };
      await walk(dir);
      return hits;
    };

    const h1 = s => { const m = s.match(/^#\s+(.+)$/m); return m ? m[1].replace(/[🧛🧚🧑🐺🔮🏹⚔️🩸*_]/g, '').trim() : ''; };

    // Characters — main card only (slug/slug.md, not -sheet.md, not journals)
    const charHits = await walkMd(path.join(cityBase, 'characters'), (p, name) => {
      if (name.endsWith('-sheet.md')) return false;
      const parts = p.split(path.sep);
      const slug = parts[parts.length - 2];
      return name === `${slug}.md`;
    });
    const characters = charHits.map(m => {
      const parts  = m.path.split(path.sep);
      const slug   = parts[parts.length - 2];
      const lineage = parts[parts.length - 3];
      const linMatch = m.content.match(/Линейка WoD[:\s*]+(.+)/);
      return { slug, name: h1(m.content) || slug, lineage: linMatch ? linMatch[1].replace(/[*_]/g, '').trim() : lineage, excerpt: mkExcerpt(m.content) };
    });

    // Locations — main card only (loc-name/loc-name.md)
    const locHits = await walkMd(path.join(cityBase, 'locations'), (p, name) => {
      if (name.endsWith('-sheet.md')) return false;
      const parts = p.split(path.sep);
      const slug = parts[parts.length - 2];
      return name === `${slug}.md`;
    });
    const locations = locHits.map(m => {
      const parts = m.path.split(path.sep);
      const slug  = parts[parts.length - 2];
      return { slug, name: h1(m.content) || slug, excerpt: mkExcerpt(m.content) };
    });

    // Chronicle modules (chronicles/*/modules/**/*.md)
    const modHits = await walkMd(path.join(cityBase, 'chronicles'), p => {
      const rel = path.relative(path.join(cityBase, 'chronicles'), p);
      return rel.includes(`${path.sep}modules${path.sep}`);
    });
    const modules = modHits.map(m => {
      const parts  = m.path.split(path.sep);
      const chrIdx = parts.findIndex(x => x === 'chronicles');
      const chronicle = parts[chrIdx + 1] || '';
      const modSlug   = parts[parts.length - 2];
      return { chronicle, module: modSlug, title: h1(m.content) || modSlug, excerpt: mkExcerpt(m.content) };
    });

    // Chronicle events.md files — extract matching lines only
    const evHits = await walkMd(path.join(cityBase, 'chronicles'), (p, n) => n === 'events.md');
    const events = [];
    for (const m of evHits) {
      const parts  = m.path.split(path.sep);
      const chrIdx = parts.findIndex(x => x === 'chronicles');
      const chronicle = parts[chrIdx + 1] || '';
      for (const line of m.content.split('\n')) {
        if (line.toLowerCase().includes(q)) {
          events.push({ chronicle, excerpt: line.trim().slice(0, 220) });
          if (events.length >= 20) break;
        }
      }
    }

    // Хроники показываются пользователю по-русски (H1 events.md), не голым слагом —
    // резолвим один раз на уникальный слаг, а не на каждый хит.
    const chrSlugs = [...new Set([...modules, ...events].map(r => r.chronicle).filter(Boolean))];
    const chrDisplayMap = Object.fromEntries(
      await Promise.all(chrSlugs.map(async s => [s, await getChronicleDisplay(city, s)]))
    );
    for (const r of modules) r.chronicleDisplay = chrDisplayMap[r.chronicle] || r.chronicle;
    for (const r of events)  r.chronicleDisplay = chrDisplayMap[r.chronicle] || r.chronicle;

    // Archive docs
    const archHits = await walkMd(path.join(cityBase, 'archive'));
    const ARCHIVE_LABELS = { 'political_state.md': 'Фракции', 'timeline.md': 'Хронология', 'visitors.md': 'Визитёры', 'rumors_elysium.md': 'Слухи (Элизиум)', 'rumors_dreaming.md': 'Слухи (Грёзы)' };
    const archive = archHits.map(m => {
      const file = path.basename(m.path);
      return { file, label: ARCHIVE_LABELS[file] || file, excerpt: mkExcerpt(m.content) };
    });

    const total = characters.length + locations.length + modules.length + events.length + archive.length;
    res.json({ query: q, results: { characters, locations, modules, events, archive }, total });
  } catch (e) { serverError(res, e); }
});

router.get('/api/integrity', async (req, res) => {
  try {
    const city    = reqCity(req);
    const chars   = await getAllCharacters(city);
    const names   = chars.map(c => c.name);
    const byName  = Object.fromEntries(chars.map(c => [c.name, c]));
    const resolve = makeNameResolver(names);

    // 1–2. Relationship symmetry + phantom targets
    const asymmetry = [];
    const phantom   = [];
    const phantomSeen = new Set();
    for (const c of chars) {
      for (const r of (c.relationships || [])) {
        const tgt = resolve(r.target);
        if (!tgt) {
          const key = c.name + '\x00' + r.target;
          if (!phantomSeen.has(key)) { phantomSeen.add(key); phantom.push(`${c.name} → «${r.target}» (карточки нет)`); }
          continue;
        }
        if (tgt === c.name) continue;
        const hasReverse = (byName[tgt].relationships || []).some(rr => resolve(rr.target) === c.name);
        if (!hasReverse) {
          const d = (r.description || '').split(';')[0].slice(0, 50);
          asymmetry.push(`${c.name} → ${tgt}${d ? ': «' + d + '»' : ''}`);
        }
      }
    }

    // 3. Chronicle participant lacking a diary entry for the event's month
    //    (only flagged for characters who already keep a journal → low noise)
    const diaryGap = [];
    const gapSeen  = new Set();
    {
      const events   = await aggregateEvents(city);
      const diaryIdx = await getDiaryIndex(city, chars);
      for (const ev of (events || [])) {
        const mk = eventMonthKey(ev.date);
        for (const p of (ev.participants || [])) {
          const name = resolve(p.name);
          if (!name) continue;
          const di = diaryIdx[name];
          if (!di || !di.has) continue;
          const preNov2010 = mk && (mk.year < 2010 || (mk.year === 2010 && mk.month < 11));
          const expected = preNov2010 ? 'retrospective.md' : (mk ? `${mk.key}.md` : null);
          if (!expected) continue;
          const dedup = name + '\x00' + expected;
          if (di.files.has(expected) || gapSeen.has(dedup)) continue;
          gapSeen.add(dedup);
          const label = preNov2010 ? 'retrospective' : mk.key;
          diaryGap.push(`${name}: нет записи «${label}» (${(ev.title || ev.date).slice(0, 40)})`);
        }
      }
    }

    // 4. Registry drift between disk folders and cities/<город>/archive/characters_index.md
    const actual     = new Set(chars.map(c => `${c.lineageFolder}/${c.slug}`));
    const referenced = new Set();
    try {
      const all = await fs.readFile(path.join(archiveDir(city), 'characters_index.md'), 'utf-8');
      // Match paths like ../characters/vampires/slug/ or characters/vampires/slug/ or vampires/slug/
      const re = /\([^)]*?\/(vampires|fairies|mortals|werewolves|mages|hunters)\/([^/)]+)\//g;
      let m;
      while ((m = re.exec(all)) !== null) referenced.add(`${m[1]}/${decodeURIComponent(m[2])}`);
    } catch {}
    const registryOrphan   = [...actual].filter(a => !referenced.has(a)).map(a => a.split('/')[1]);
    const registryDangling = [...referenced].filter(r => !actual.has(r)).map(r => r.split('/')[1]);

    const checks = [
      { id: 'asymmetry',         label: 'Односторонние связи',              severity: 'warn', hint: 'A ссылается на B, но B не ссылается на A',                items: asymmetry },
      { id: 'phantom',           label: 'Связи на несуществующие карточки', severity: 'info', hint: 'цель связи не сопоставлена с карточкой (возможен алиас/прозвище)', items: phantom },
      { id: 'diary_gap',         label: 'Участник без дневника за месяц',   severity: 'info', hint: 'у персонажа есть журнал, но нет записи за месяц события', items: diaryGap },
      { id: 'registry_orphan',   label: 'Папка не внесена в characters_ALL',severity: 'warn', hint: 'персонаж есть на диске, но не в реестре',                 items: registryOrphan },
      { id: 'registry_dangling', label: 'Запись реестра без папки',         severity: 'err',  hint: 'реестр ссылается на несуществующую папку',               items: registryDangling },
    ];

    const totalIssues = checks.reduce((n, c) => n + c.items.length, 0);
    res.json({ brokenLinks: getBrokenLinks(), totalIssues, checks });
  } catch (e) { serverError(res, e); }
});

// canon-check (AI) moved to routes/generation.js (E1.2)

module.exports = { router };
