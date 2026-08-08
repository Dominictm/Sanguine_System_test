# Техспека: легенда/фильтр графа для новых типов связи (хвост Фазы 1)

**Роль:** Системный аналитик · **Дата:** 2026-08-08
**Источник:** [2026-08-08-relations-management-techspec.md](2026-08-08-relations-management-techspec.md)
§6.1 — на момент Фазы 1 явно отмечено как известное ограничение («не входит в эту техспеку»),
поскольку зависело от структурного поля типа, которого тогда ещё не было. Поле появилось в
[Фазе 2](2026-08-08-relations-field-split-techspec.md) (`relType`), обе последующие фазы это
ограничение не трогали — закрываю сейчас.

## Проблема (напоминание из Фазы 1, §6.1)

Обводка ребра графа уже красится правильно (`d.color || REL_COLORS[d.type] || REL_COLORS.neutral`,
`web/public/scripts/graph.js`) — цвет находится через подстрочное/точное сопоставление с
библиотекой «Постоянные связи» (`web/routes/dashboard.js`, `matchRelType`). Но **само значение
`type` на ребре** до сих пор — это выход старого классификатора по ключевым словам
(`categorizeRel`, `web/lib/parsers/character.js`), а не слаг найденной «Постоянной связи». Из-за
этого три производные вещи графа продолжают жить в «старом мире»:

1. **Легенда/фильтр** (`buildRelTypeFilter`) строит чипы только по ключам хардкодного `REL_LABELS`
   — тип, которого там нет (Гуль/Домитор/Брат/Сестра — новые в Фазе 3 — и вообще любой
   пользовательский, добавленный через модалку «Управление связями»), не получает своего чипа
   фильтра вообще, хотя на графе уже виден собственным цветом.
2. **Маркеры стрелок** (`renderGraph`, `Object.entries(REL_COLORS).forEach(...)`) заводятся
   только для хардкодных ключей — ребро с новым типом рискует остаться без наконечника стрелки
   (`marker-end` ссылается на несуществующий `<marker id="arr-…">`).
3. **Цвет точки в инфопанели** (`showInfoPanel`, `rel-type-dot`) группирует по `type` и красит
   через `REL_COLORS[type] || 'var(--text3)'` — для нового типа всегда серый, даже когда у самого
   ребра уже есть правильный `color`.

Теперь, когда `relType` — настоящее структурное поле (Фаза 2) с надёжным точным сопоставлением
(Фаза 1, доработано Фазой 2 — `matchRelType(relType, description)` сначала точное совпадение по
`relType`), можно перестать полагаться на классификатор там, где есть матч, и починить все три
пункта разом.

---

## §1. Сервер — `web/routes/dashboard.js`, `/api/graph`

`type`/`type2` на ребре становятся слагом найденной «Постоянной связи», когда она есть; иначе —
прежний фоллбэк на `categorizeRel`. Заодно добавляются `color2`/`typeLabel2` для второй стороны
пары (симметрично уже существующим `color`/`typeLabel` первой) — нужно для корректного цвета точки
в инфопанели, когда показывается **своя** формулировка второго персонажа (`type2`, уже
существующий механизм FIX-13).

Было:
```js
    const links = [];
    const byKey = new Map();
    for (const c of chars) {
      for (const r of c.relationships) {
        const tgt = resolveTarget(r.target);
        if (!tgt || tgt === c.name) continue;
        const key = [c.name, tgt].sort().join('\x00');
        const label = r.relType || r.description.split(';')[0].slice(0, 55);
        const matched = matchRelType(r.relType, r.description);
        const existing = byKey.get(key);
        if (!existing) {
          const link = { source: c.name, target: tgt, type: r.type,
                         label, fromChar: c.name, description: r.description,
                         ...(matched ? { color: matched.color, typeLabel: matched.name } : {}) };
          byKey.set(key, link);
          links.push(link);
        } else if (!existing.fromChar2 && existing.fromChar !== c.name) {
          existing.fromChar2    = c.name;
          existing.type2        = r.type;
          existing.label2       = label;
          existing.description2 = r.description;
        }
      }
    }
```

Стало:
```js
    const links = [];
    const byKey = new Map();
    for (const c of chars) {
      for (const r of c.relationships) {
        const tgt = resolveTarget(r.target);
        if (!tgt || tgt === c.name) continue;
        const key = [c.name, tgt].sort().join('\x00');
        const label = r.relType || r.description.split(';')[0].slice(0, 55);
        const matched = matchRelType(r.relType, r.description);
        // Слаг «Постоянной связи» вместо категории по ключевым словам, когда есть точное/
        // подстрочное совпадение — легенда/фильтр/маркеры графа (graph.js) теперь опираются
        // на него напрямую, не только цвет ребра (см. техспеку «хвост Фазы 1», 2026-08-08).
        const resolvedType = matched ? matched.slug : r.type;
        const existing = byKey.get(key);
        if (!existing) {
          const link = { source: c.name, target: tgt, type: resolvedType,
                         label, fromChar: c.name, description: r.description,
                         ...(matched ? { color: matched.color, typeLabel: matched.name } : {}) };
          byKey.set(key, link);
          links.push(link);
        } else if (!existing.fromChar2 && existing.fromChar !== c.name) {
          existing.fromChar2    = c.name;
          existing.type2        = resolvedType;
          existing.label2       = label;
          existing.description2 = r.description;
          if (matched) { existing.color2 = matched.color; existing.typeLabel2 = matched.name; }
        }
      }
    }
```

---

## §2. Клиент — `web/public/scripts/graph.js`

### 2.1 Легенда/фильтр (`buildRelTypeFilter`, строки 140-150)

Было:
```js
function buildRelTypeFilter() {
  const present = new Set((STATE.graph.data?.links || []).map(l => l.type).filter(Boolean));
  const keys = Object.keys(REL_LABELS).filter(k => present.has(k));
  STATE.graph.relTypeFilter = new Set(keys);
  document.getElementById('graph-reltype-filter').innerHTML = keys.map(k => `
    <label class="graph-filter-chip">
      <input type="checkbox" data-reltype-filter="${k}" checked>
      ${REL_LABELS[k]}
      <span class="reltype-swatch" style="background:${REL_COLORS[k]}"></span>
    </label>`).join('');
}
```
Стало:
```js
function buildRelTypeFilter() {
  const links = STATE.graph.data?.links || [];
  const present = new Set(links.map(l => l.type).filter(Boolean));
  // Подпись/цвет — сначала из самого ребра (typeLabel/color — «Постоянная связь», не входящая
  // в хардкодный REL_LABELS/REL_COLORS), иначе фоллбэк на старый хардкодный набор (легаси-связи
  // без совпадения с библиотекой — классификатор categorizeRel).
  const meta = new Map(); // type → { label, color }
  for (const l of links) {
    if (!l.type || meta.has(l.type)) continue;
    meta.set(l.type, {
      label: l.typeLabel || REL_LABELS[l.type] || l.type,
      color: l.color || REL_COLORS[l.type] || REL_COLORS.neutral,
    });
  }
  // Старые хардкодные типы — первыми (стабильный, привычный порядок), новые — следом.
  const keys = Object.keys(REL_LABELS).filter(k => present.has(k))
    .concat([...present].filter(k => !REL_LABELS[k]));
  STATE.graph.relTypeFilter = new Set(keys);
  document.getElementById('graph-reltype-filter').innerHTML = keys.map(k => {
    const m = meta.get(k) || { label: REL_LABELS[k] || k, color: REL_COLORS[k] || REL_COLORS.neutral };
    return `
    <label class="graph-filter-chip">
      <input type="checkbox" data-reltype-filter="${k}" checked>
      ${m.label}
      <span class="reltype-swatch" style="background:${m.color}"></span>
    </label>`;
  }).join('');
}
```

### 2.2 Маркеры стрелок (`renderGraph`, строки 205-214)

Было:
```js
  // Arrow markers
  Object.entries(REL_COLORS).forEach(([type, color]) => {
    defs.append('marker')
      .attr('id', `arr-${type}`)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', color).attr('opacity', .7);
  });
```
Стало:
```js
  // Arrow markers — по факту присутствующим типам в ТЕКУЩИХ данных, не только по хардкодному
  // REL_COLORS: «Постоянные связи» (библиотека, растёт со временем) дают слаги, которых в
  // фиксированном наборе нет — без этого у таких рёбер отсутствовал бы наконечник стрелки
  // (marker-end ссылался бы на несуществующий <marker>).
  const markerColors = new Map(Object.entries(REL_COLORS));
  data.links.forEach(l => { if (l.type && !markerColors.has(l.type)) markerColors.set(l.type, l.color || REL_COLORS.neutral); });
  markerColors.forEach((color, type) => {
    defs.append('marker')
      .attr('id', `arr-${type}`)
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 22).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', color).attr('opacity', .7);
  });
```
(`type` всегда id-безопасен — слаг «Постоянной связи» строится через `slugify()`, транслитерация
+ только алфавитно-цифровые символы/подчёркивание, см. Фазу 1.)

### 2.3 Цвет точки в инфопанели (`showInfoPanel`, строки 407-431)

Было:
```js
  const relsByType = {};
  for (const l of outLinks) {
    const isSource = l.source.id === d.id;
    const other    = isSource ? l.target.id : l.source.id;
    const own  = d.id === l.fromChar2;
    const desc = own ? l.description2 : (d.id === l.fromChar ? l.description : `← ${l.description}`);
    const type = own ? (l.type2 || l.type) : l.type;
    if (!relsByType[type]) relsByType[type] = [];
    relsByType[type].push({ other, desc });
  }

  const relsHtml = Object.entries(relsByType).map(([type, items]) =>
    items.map(({ other, desc }) => `
      <div class="rel-item">
        <div class="rel-target">
          <div class="rel-type-dot" style="background:${REL_COLORS[type] || 'var(--text3)'}"></div>
          ${escHtml(other)}
        </div>
        <div class="rel-desc">${escHtml(desc)}</div>
      </div>`).join('')
  ).join('');
```
Стало:
```js
  const relsByType = {}; // type → { color, items: [] }
  for (const l of outLinks) {
    const isSource = l.source.id === d.id;
    const other    = isSource ? l.target.id : l.source.id;
    const own   = d.id === l.fromChar2;
    const desc  = own ? l.description2 : (d.id === l.fromChar ? l.description : `← ${l.description}`);
    const type  = own ? (l.type2 || l.type) : l.type;
    const color = own ? (l.color2 || l.color) : l.color;
    if (!relsByType[type]) relsByType[type] = { color: color || REL_COLORS[type] || 'var(--text3)', items: [] };
    relsByType[type].items.push({ other, desc });
  }

  const relsHtml = Object.values(relsByType).map(({ color, items }) =>
    items.map(({ other, desc }) => `
      <div class="rel-item">
        <div class="rel-target">
          <div class="rel-type-dot" style="background:${color}"></div>
          ${escHtml(other)}
        </div>
        <div class="rel-desc">${escHtml(desc)}</div>
      </div>`).join('')
  ).join('');
```

---

## §3. Краевые случаи

- **Обводка ребра** (`link.attr('stroke', d => d.color || REL_COLORS[d.type] || REL_COLORS.neutral)`)
  — не меняется, уже корректна (Фаза 1): `d.color` при совпадении всегда в приоритете.
- **`applyGraphFilters`** (`activeRelType.has(l.type)`) — не меняется, работает одинаково для
  обоих видов `type` (слаг библиотеки или слаг классификатора) — множество строится из тех же
  реальных значений на рёбрах.
- **Совпадение слага новой «Постоянной связи» с уже хардкодным ключом** (например пользователь
  случайно назвал свою связь так, что `slugify()` совпал с `'neutral'`) — теоретически возможно,
  практически ничтожно (транслитерация кириллицы редко даёт готовое английское слово из
  хардкодного набора). Не защищаю специально — тот же уровень риска, что уже принят для
  остальных slug-based сопоставлений в проекте.
- **`?compact=true`** (агрегированный граф) — не затронут, использует отдельный синтетический
  `type: 'aggregate'`, эта техспека его не трогает.

## §4. Тест-план

- Живая проверка (`run-sanguine-web`): создать связь с типом «Гуль» (из Фазы 3 seed-набора,
  ранее не входил в старый классификатор) → граф → убедиться, что: (а) в фильтре типов связи
  появился отдельный чип «Гуль» с правильным цветом-квадратиком; (б) ребро имеет наконечник
  стрелки того же цвета; (в) клик по узлу → в инфопанели точка рядом со связью — того же цвета,
  не серая. Повторить для полностью авторского типа, добавленного через модалку «Управление
  связями» (не входящего ни в один из 11 сид-типов).
- Регресс: существующая легаси-связь без `relType` (старый формат, чистый свободный текст,
  распознанный `categorizeRel`) — фильтр/цвет/стрелка продолжают работать как раньше (через
  фоллбэк на `REL_COLORS[классификатор-слаг]`).
- `npm test` — новых серверных тестов не требуется сверх уже имеющихся на `matchRelType`/граф
  (чисто клиентская отрисовка легенды не покрывается юнит-тестами в этом проекте), но прогнать
  полный набор ради регресса.

## §5. Порядок реализации

Один связный кусок — §1 (сервер) → §2 (все три точки клиента вместе, зависят от §1). Не делится
на части, частичное применение (например только §2 без §1) не даст эффекта — `type` на ребре
останется прежним классификатор-слагом, и все три клиентских фикса окажутся no-op.
