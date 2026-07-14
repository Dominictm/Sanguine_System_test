'use strict';
// city.md build/parse + archive/political_state.md faction-influence table.
// Extracted from parsers.js during the 2026-07-12 decomposition.

const { slugify } = require('./shared');

// ── city.md ──────────────────────────────────────────────────────────────────
// Single source of truth for the city.md section layout, shared by tools/new_city.js,
// POST/PUT /api/cities and the edit form. Order = order rendered in the file.
const CITY_SECTIONS = [
  ['political',  'Политический ландшафт'],
  ['factions',   'Фракции'],
  ['locations',  'Ключевые локации'],
  ['leitmotif',  'Лейтмотивы и атмосфера'],
  ['specifics',  'Специфика ответа'],
  ['avoid',      'Чего избегать'],
  ['sources',    'Источники'],
];

// Multi-line textarea → markdown bullet list; empty → placeholder.
function _citySection(txt) {
  const lines = String(txt == null ? '' : txt).split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length ? lines.map(l => l.startsWith('-') ? l : `- ${l}`).join('\n') : '- …';
}

const CITY_DEFAULT_DESCRIPTION = 'Опиши здесь свой домен — то, с чем сверяется Рассказчик перед сценой (см. CLAUDE.md → «Активный город»).';

/**
 * Собирает содержимое city.md из полей формы.
 * @param {{display?, year?, description?, political?, factions?, locations?, leitmotif?, specifics?, avoid?, sources?}} fields
 * @returns {string} готовый Markdown city.md
 */
function buildCityMd(fields = {}) {
  const display     = String(fields.display || '').trim() || 'Город';
  const year        = String(fields.year || '').trim() || '20XX';
  const description = String(fields.description || '').trim() || CITY_DEFAULT_DESCRIPTION;
  const body = CITY_SECTIONS.map(([key, heading]) => `## ${heading}\n${_citySection(fields[key])}`).join('\n\n');
  return `# ${display}, ${year} — сеттинг города

${description}

${body}
`;
}

/**
 * Разбирает city.md обратно в структуру для формы редактирования.
 * @param {string} raw — содержимое city.md
 * @returns {{display: string, year: string, description: string, sections: Object<string,string>}}
 *   sections — по ключам CITY_SECTIONS (political/factions/locations/…), каждый — «плоский» текст без буллетов
 */
function parseCityMd(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  let display = '', year = '';
  const hm = text.match(/^#\s+(.+?)\s*$/m);
  if (hm) {
    const h1 = hm[1].replace(/\s*—\s*сеттинг города\s*$/i, '').trim();
    const m2 = h1.match(/^(.*?),\s*([^,]+?)\s*$/);
    if (m2) { display = m2[1].trim(); year = m2[2].trim(); }
    else display = h1;
  }
  // Текст между заголовком H1 и первой секцией "##" — общее описание/сеттинг города.
  let description = '';
  if (hm) {
    const afterH1 = text.slice(hm.index + hm[0].length);
    const firstHeadingIdx = afterH1.search(/^##\s+/m);
    const introRaw = firstHeadingIdx === -1 ? afterH1 : afterH1.slice(0, firstHeadingIdx);
    description = introRaw.split('\n').map(l => l.replace(/^>\s?/, '')).join('\n').trim();
  }
  const headingToKey = new Map(CITY_SECTIONS.map(([k, h]) => [h.toLowerCase(), k]));
  const sections = {};
  for (const part of text.split(/^##\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim().toLowerCase();
    const key = headingToKey.get(heading);
    if (!key) continue;
    const bodyTxt = nl === -1 ? '' : part.slice(nl + 1);
    sections[key] = bodyTxt.split('\n').map(l => l.replace(/^\s*-\s?/, '').trim())
      .filter(l => l && l !== '…').join('\n');
  }
  return { display, year, description, sections };
}

// Полный каркас нового города — ЕДИНЫЙ источник для POST /api/cities и tools/new_city.js.
// Чистая функция: только строит данные (содержимое файлов + список пустых папок под
// .gitkeep). Сам ввод-вывод делают вызывающие (атомарная запись в сервере, синхронная
// в CLI). До выноса оба пути хардкодили эти шаблоны по отдельности и успели разойтись
// (в visitors.md) — теперь источник один. Принимает те же поля, что buildCityMd, плюс
// districts (CSV-строка или массив).
/**
 * @param {{display?, year?, districts?: string|string[], ...}} fields — те же поля, что buildCityMd
 * @returns {{files: Object<string,string>, keepDirs: string[]}}
 *   files — относительные пути → содержимое (city.md, archive/*.md, стартовая хроника);
 *   keepDirs — пустые папки под .gitkeep (character-линейки, chronicles/, districts/…)
 */
function cityScaffold(fields = {}) {
  const display   = String(fields.display || '').trim() || 'Город';
  const year      = String(fields.year || '').trim() || '20XX';
  const districts = (Array.isArray(fields.districts)
    ? fields.districts
    : String(fields.districts || '').split(','))
    .map(d => String(d).trim()).filter(Boolean);

  // Seed «Баланс сил — обзор» (влияние — см. parsePoliticalFactions/setPoliticalFactionInfluence)
  // из тех же фракций, что и city.md → «## Фракции», с влиянием 0%, если они уже указаны при создании.
  const factionNames = String(fields.factions || '').split('\n')
    .map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  const balanceRows = factionNames.length
    ? factionNames.map(name => `| ${name} | 0% |  |  |`).join('\n')
    : '|  |  |  |  |';

  const files = {
    'city.md': buildCityMd(fields),
    'archive/events.md':
`# 📖 Хроника «${display}» — События

> 🔗 Все персонажи — [characters_index.md](characters_index.md)
> 🔗 Протокол записей — [chronicle.md](../../../system/rules/chronicle.md)

---

## 🌍 Состояние мира

> Обновляется после каждой сессии.
> Последнее обновление: **—**.

---

## 📋 Сводная хроника событий

> Агрегат из \`chronicles/<хроника>/events.md\`. Индекс генерируется \`tools/build_city_events.js\` — вручную не править.

<!-- AUTO:events-index -->
<!-- /AUTO:events-index -->
`,
    'archive/political_state.md':
`# Карта фракций — ${display}, ${year}

> Шаблон. Кто контролирует домен, иерархия, ключевые NPC, конфликты.

| Должность | Персонаж | Клан | Примечание |
|---|---|---|---|
|  |  |  |  |

---

## Баланс сил — обзор

| Фракция | Сила | Территория | Угроза |
|---|---|---|---|
${balanceRows}
`,
    'archive/characters_index.md':
`# Персонажи — ${display}

> Сводник. Добавляется при создании карточек (по \`system/rules/npcs_city.md\`).
`,
    'archive/visitors.md':
`# Гости из других городов — ${display}

> Персонажи с \`Родной город\` ≠ ${display}, присутствующие здесь. Только ссылки —
> карточка-источник живёт в родном городе (один источник истины).

| Персонаж | Родной город | Появление |
|---|---|---|
|  |  |  |
`,
  };

  files['chronicles/sluchaynye_sobytiya/chronicle.md'] =
`# 📂 Случайные события

| **Статус:** | 🟡 Активна |
| **Скрыта** | да |

> Хроника для случайных/фоновых событий города. Не отображается в индексе хроник.
`;
  files['chronicles/sluchaynye_sobytiya/events.md'] =
`# Случайные события — События

`;

  const keepDirs = [
    ...['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'].map(l => `characters/${l}`),
    'chronicles',
    'chronicles/sluchaynye_sobytiya/modules',
    'rules',
  ];
  if (districts.length) {
    // Дедуп по итоговому слагу: два района с одинаковым именем (или дающие один слаг)
    // не создают дублирующих папок. Оставшиеся нумеруются подряд district_01, 02…
    const seen = new Set();
    districts.forEach((d, i) => {
      const dslug = slugify(d) || `rayon_${String(i + 1).padStart(2, '0')}`;
      if (seen.has(dslug)) return;
      seen.add(dslug);
      keepDirs.push(`locations/district_${String(seen.size).padStart(2, '0')}/${dslug}`);
    });
    if (!seen.size) keepDirs.push('locations');
  } else {
    keepDirs.push('locations');
  }

  return { files, keepDirs };
}

// ── Faction influence (archive/political_state.md, «Баланс сил — обзор») ───────
// Таблица `| Фракция | Сила | Территория | Угроза |`. «Сила» изначально (в
// реальных файлах, задолго до этой фичи) хранилась как 5-нотчевая шкала блоков
// (⬛⬛⬛⬜⬜) — читаем её и сейчас для обратной совместимости. Но с шагом 5 (0-100,
// 20 градаций) блоки нечитаемы (пришлось бы городить 20 глифов в ячейке), поэтому
// НОВЫЕ записи пишутся простым числом-процентом («80%») — миграция не нужна:
// старые файлы с блоками продолжают парситься как раньше, при первой правке
// через setPoliticalFactionInfluence конкретная строка переходит на числовой вид.
const _POLFAC_HEADER_RE = /^\s*\|.*Фракция.*\|.*Сила.*\|/i;
const INFLUENCE_STEP = 5;

function _polFacCellText(influence) {
  const n = Math.max(0, Math.min(100, Math.round((Number(influence) || 0) / INFLUENCE_STEP) * INFLUENCE_STEP));
  return `${n}%`;
}
function _polFacParseCell(cell) {
  const t = String(cell || '').trim();
  if (/[⬛⬜]/.test(t)) return (t.match(/⬛/g) || []).length * 20; // legacy 5-блочная нотация
  const m = t.match(/(\d+)/);
  return m ? Math.max(0, Math.min(100, parseInt(m[1], 10))) : 0;
}
function _polFacRow(cells) {
  return cells.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

/**
 * @param {string} raw — содержимое political_state.md
 * @returns {{name: string, influence: number, territory: string, threat: string}[]}
 */
function parsePoliticalFactions(raw) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headerIdx = lines.findIndex(l => _POLFAC_HEADER_RE.test(l));
  if (headerIdx === -1) return [];
  let i = headerIdx + 2; // header + `|---|---|` separator
  const out = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    const cells = _polFacRow(lines[i]);
    if (cells[0] && !/^-+$/.test(cells[0])) {
      out.push({ name: cells[0], influence: _polFacParseCell(cells[1]), territory: cells[2] || '', threat: cells[3] || '' });
    }
    i++;
  }
  return out;
}

/**
 * Устанавливает влияние одной фракции (создаёт строку/таблицу, если их ещё нет),
 * не трогая остальное содержимое файла.
 * @param {string} raw — содержимое political_state.md
 * @param {string} name — точное название фракции (как в колонке «Фракция»)
 * @param {number} influence — 0-100, округляется до шага 5
 * @returns {string} обновлённое содержимое файла
 */
function setPoliticalFactionInfluence(raw, name, influence) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const cellText = _polFacCellText(influence);
  const headerIdx = lines.findIndex(l => _POLFAC_HEADER_RE.test(l));

  if (headerIdx === -1) {
    // Таблицы ещё нет в файле — создаём с нуля и добавляем первой строкой.
    const table = [
      '## Баланс сил — обзор', '',
      '| Фракция | Сила | Территория | Угроза |',
      '|---|---|---|---|',
      `| ${name} | ${cellText} |  |  |`,
      '',
    ].join('\n');
    return text.replace(/\s*$/, '\n\n') + table;
  }

  let i = headerIdx + 2;
  let found = false;
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    const cells = _polFacRow(lines[i]);
    if (cells[0] === name) {
      cells[1] = cellText;
      lines[i] = `| ${cells.join(' | ')} |`;
      found = true;
      break;
    }
    i++;
  }
  if (!found) lines.splice(i, 0, `| ${name} | ${cellText} |  |  |`);
  return lines.join('\n');
}

/**
 * Удаляет строку фракции из таблицы «Баланс сил — обзор», не трогая остальное.
 * @param {string} raw — содержимое political_state.md
 * @param {string} name — точное название фракции
 * @returns {{updated: string, found: boolean}}
 */
function removePoliticalFaction(raw, name) {
  const text = String(raw == null ? '' : raw).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headerIdx = lines.findIndex(l => _POLFAC_HEADER_RE.test(l));
  if (headerIdx === -1) return { updated: text, found: false };
  let i = headerIdx + 2;
  while (i < lines.length && /^\s*\|/.test(lines[i])) {
    if (_polFacRow(lines[i])[0] === name) {
      lines.splice(i, 1);
      return { updated: lines.join('\n'), found: true };
    }
    i++;
  }
  return { updated: text, found: false };
}

module.exports = {
  CITY_SECTIONS, CITY_DEFAULT_DESCRIPTION, buildCityMd, parseCityMd,
  cityScaffold, parsePoliticalFactions, setPoliticalFactionInfluence, removePoliticalFaction,
};
