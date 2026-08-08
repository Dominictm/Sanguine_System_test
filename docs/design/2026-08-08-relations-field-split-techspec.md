# Техспека (Фаза 2): разделение «Вид отношений» на короткий тип + описание

**Роль:** Системный аналитик · **Дата:** 2026-08-08
**Источник:** [2026-08-08-relations-management-analysis.md](2026-08-08-relations-management-analysis.md)
(Аналитик, §«П.3»), реализовано поверх уже сданной Фазы 1
([2026-08-08-relations-management-techspec.md](2026-08-08-relations-management-techspec.md) —
библиотека «Постоянные связи», `web/lib/relation-types.js`, `/api/library/relation-types`).

## §0. Границы этой техспеки

Реализует п.3 запроса целиком. **Не реализует** «Взаимно» (п.4) и авто-пары Сир/Чайлд·Брат/
Сестра·Домитор/Гуль (п.5-7) — они запланированы отдельной Фазой 3, которая расширит формат,
введённый здесь, добавив признак взаимности (см. развилку анализа №4). Эта техспека сознательно
делает формат **достаточным, но не избыточным** для сегодняшней задачи — не добавляет поле под
взаимность впрок, чтобы не плодить неиспользуемый код (в духе `CLAUDE.md`: не абстрагироваться
сверх того, что требует текущая задача). Обратная связь: если Фаза 3 потребует ещё одного
небольшого расширения формата — это нормально, проект уже привык к маленьким последовательным
миграциям (`tools/migrations/001`-`007`), не к одной всеобъемлющей.

**Миграция не нужна.** Старые карточки продолжают парситься как раньше (без структурного типа,
`categorizeRel(desc)` — тот же классификатор по ключевым словам, что и сегодня, бессрочный
фоллбэк) — решение согласовано в анализе (§«Ключевые архитектурные развилки», п.2): не пытаться
угадать тип из уже написанного пользователями свободного текста.

---

## §1. Формат хранения — необязательный префикс `[Тип]` перед описанием

Было: `- Имя[, Имя2] — Описание`.
Стало: `- Имя[, Имя2] — [Тип] Описание` (если тип указан) **или** `- Имя[, Имя2] — Описание`
(если тип не указан, пользователь оставил поле пустым — байт-в-байт как сегодня, нулевое
изменение для этого случая).

**Почему квадратные скобки, а не `:`/`;`.** Оба альтернативных разделителя рассматривались:
`;` уже используется дальше по коду для превью-обрезки лейбла ребра графа
(`web/routes/dashboard.js`, `r.description.split(';')[0]`), но это может случайно встретиться
ГДЕ УГОДНО в старом свободном тексте («не отдаёт долг; постоянно врёт»); `:` — то же самое
(«Заметка: подозрительна»). `[` **в начале** описания практически не встречается в реальных
данных естественным образом — минимальный риск ложного срабатывания на легаси-текстах, которые
эта техспека сознательно не трогает и не переразбирает.

**Парсер не пытается сопоставить `[Тип]` со списком «Постоянных связей»** — это не проверка
допустимости, а чистое извлечение подстроки. Тип может быть и произвольным (пользователь мог
не выбрать из пикера, а вписать свой — тот же принцип «из списка или свой», что уже у
Дисциплин/Титулов).

### 1.1 Парсер — `web/lib/parsers/character.js`, блок `relBlock` (строки 186-202)

Было:
```js
  const relBlock = content.match(/- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/);
  if (relBlock) {
    const lines = relBlock[1].split('\n').filter(l => /^\s+-/.test(l));
    for (const line of lines) {
      const clean = line.trim().replace(/^-\s*/, '');
      const dash  = clean.indexOf(' — ');
      if (dash === -1) continue;
      const targets = clean.slice(0, dash).split(',')
        .map(t => t.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
        .filter(Boolean);
      const desc = clean.slice(dash + 3).trim();
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, type: categorizeRel(desc) });
      }
    }
  }
```

Стало:
```js
  const relBlock = content.match(/- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/);
  if (relBlock) {
    const lines = relBlock[1].split('\n').filter(l => /^\s+-/.test(l));
    for (const line of lines) {
      const clean = line.trim().replace(/^-\s*/, '');
      const dash  = clean.indexOf(' — ');
      if (dash === -1) continue;
      const targets = clean.slice(0, dash).split(',')
        .map(t => t.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
        .filter(Boolean);
      const rest = clean.slice(dash + 3).trim();
      // Структурный тип (2026-08-08, Фаза 2) — необязательный префикс «[Тип] Описание».
      // Легаси-записи (без префикса) остаются с relType='' — categorizeRel(desc) по-прежнему
      // определяет type (слаг для графа) по всему тексту, как раньше.
      const typeMatch = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
      const relType = typeMatch ? typeMatch[1].trim() : '';
      const desc    = typeMatch ? typeMatch[2].trim() : rest;
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, relType, type: categorizeRel(relType || desc) });
      }
    }
  }
```

`type: categorizeRel(relType || desc)` — классификатор теперь получает короткий `relType`,
если он есть (точнее, чем гонять по всей развёрнутой прозе), иначе прежнее поведение по `desc`.
`relType` — НОВОЕ поле объекта связи, отдельное от `type` (слаг-классификатора, уже
используемого графом/`REL_COLORS`) — не переиспользовать `type` под это, разная семантика.

---

## §2. Форма редактирования — `web/public/scripts/scripts.js` + `char-detail.js`

### 2.1 `_relRowHtml` (scripts.js:1647-1653) — три параметра вместо двух, пикер вместо datalist

Было:
```js
function _relRowHtml(target = '', description = '') {
  return `<div class="cdet-rel-row">
    <input class="cdet-rel-name-inp" list="cdet-rel-names" placeholder="Имя персонажа" value="${escAttr(target)}">
    <input class="cdet-rel-type-inp" list="cdet-rel-types" placeholder="Вид отношений / описание" value="${escAttr(description)}">
    <button class="cdet-rel-del-btn" type="button" title="Удалить связь">✕</button>
  </div>`;
}
```

Стало:
```js
function _relRowHtml(target = '', relType = '', description = '') {
  return `<div class="cdet-rel-row">
    <div class="cdet-rel-row-top">
      <input class="cdet-rel-name-inp" list="cdet-rel-names" placeholder="Имя персонажа" value="${escAttr(target)}">
      <input class="cdet-rel-type-inp" placeholder="Вид отношений" value="${escAttr(relType)}">
      <button type="button" class="cdet-rel-type-pick-btn" title="Выбрать из библиотеки" aria-label="Выбрать вид отношений из библиотеки">📚</button>
      <button class="cdet-rel-del-btn" type="button" title="Удалить связь">✕</button>
    </div>
    <textarea class="cdet-rel-desc-inp" placeholder="Развёрнутое описание (необязательно)" rows="2">${escHtml(description)}</textarea>
  </div>`;
}
```
`cdet-rel-types`-datalist (старый `REL_TYPE_OPTIONS`) удаляется — см. §2.4.

### 2.2 Единственная общая панель-пикер типа связи — не по одной на строку

Строки добавляются/удаляются динамически (`+ Добавить связь`), значит панель-пикер с
фиксированным id **нельзя** дублировать в разметке каждой строки — тот же класс бага, что уже
однажды находили и чинили в этой сессии для пикеров фракций города (дефект №1 QA-отчёта
2026-08-08). Решение: **одна** панель на всю вкладку, физически перемещается к строке, у которой
нажали 📚 (`insertAdjacentElement`) — не клонируется, id остаётся единственным в DOM всегда.

`char-detail.js`, разметка вкладки «Отношения» (было — строки 181-186):
```js
          <div id="cdet-rels-edit" style="display:none">
            <div class="cdet-rels-hint">Имя — выбери из списка или впиши своё. Вид отношений — из списка или свой.</div>
            <div id="cdet-rels-rows">${(c.relationships||[]).map(r => _relRowHtml(r.target, r.description)).join('')}</div>
            <button class="cdet-rel-add-btn" id="cdet-rel-add-btn" type="button">+ Добавить связь</button>
            <datalist id="cdet-rel-names">${(STATE.characters||[]).filter(x => x.slug !== c.slug).map(x => `<option value="${escAttr(x.name)}">`).join('')}</datalist>
            <datalist id="cdet-rel-types">${REL_TYPE_OPTIONS.map(t => `<option value="${escAttr(t)}">`).join('')}</datalist>
          </div>
```

Стало:
```js
          <div id="cdet-rels-edit" style="display:none">
            <div class="cdet-rels-hint">Имя — выбери из списка или впиши своё. Вид отношений — из библиотеки или свой.</div>
            <div id="cdet-rels-rows">${(c.relationships||[]).map(r => _relRowHtml(r.target, r.relType, r.description)).join('')}</div>
            <button class="cdet-rel-add-btn" id="cdet-rel-add-btn" type="button">+ Добавить связь</button>
            <div id="cdet-rel-type-picker" class="v20-lib-picker cdet-lib-picker-panel" hidden>
              <input type="text" class="v20-lib-search" placeholder="Поиск по названию…" id="cdet-rel-type-search">
              <div class="v20-lib-list" id="cdet-rel-type-list"></div>
            </div>
            <datalist id="cdet-rel-names">${(STATE.characters||[]).filter(x => x.slug !== c.slug).map(x => `<option value="${escAttr(x.name)}">`).join('')}</datalist>
          </div>
```
(`cdet-rel-names` — даталист имён персонажей, без изменений, остаётся.)

### 2.3 Клик-делегаты — новый блок (добавить рядом с уже существующими делегатами пикеров, `char-detail.js`)

```js
// Единственная панель на все строки «Отношения» (§2.2) — переезжает к активной строке,
// не дублируется. _activeRelTypeInput — куда писать выбранное значение.
let _activeRelTypeInput = null;
async function _renderRelTypePickerList(query) {
  const types = await ensureRelTypes(); // relations-manage.js (Фаза 1) — общий кеш, не дублируем fetch
  const q = (query || '').toLowerCase();
  const list = types.filter(t => !q || t.name.toLowerCase().includes(q));
  const box = document.getElementById('cdet-rel-type-list');
  if (box) box.innerHTML = list.length
    ? list.map(t => `<button type="button" class="v20-lib-item" data-name="${escAttr(t.name)}"><span>${escHtml(t.name)}</span></button>`).join('')
    : '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>';
}
document.addEventListener('click', async e => {
  const pickBtn = e.target.closest('.cdet-rel-type-pick-btn');
  if (pickBtn) {
    const row = pickBtn.closest('.cdet-rel-row');
    _activeRelTypeInput = row.querySelector('.cdet-rel-type-inp');
    const picker = document.getElementById('cdet-rel-type-picker');
    row.insertAdjacentElement('afterend', picker); // переносим панель к этой строке
    if (picker.hidden) { picker.hidden = false; await _renderRelTypePickerList(''); }
    else picker.hidden = true;
    return;
  }
  const item = e.target.closest('#cdet-rel-type-picker .v20-lib-item');
  if (item) {
    if (_activeRelTypeInput) _activeRelTypeInput.value = item.dataset.name || '';
    document.getElementById('cdet-rel-type-picker').hidden = true;
    _activeRelTypeInput?.focus();
    return;
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'cdet-rel-type-search') _renderRelTypePickerList(e.target.value);
});
```
`ensureRelTypes()` — уже существующая функция из `web/public/scripts/relations-manage.js` (Фаза
1), глобальная, с собственным кешем (`_relTypesCache`) — переиспользуется как есть, без правок
в том файле.

### 2.4 Удалить `REL_TYPE_OPTIONS` — `web/public/scripts/scripts.js:188`

Строка `const REL_TYPE_OPTIONS = [...]` удаляется целиком — единственный потребитель (datalist
§2.2) заменён пикером. Мёртвый код, не оставлять.

### 2.5 Сбор строк при сохранении — `char-detail.js`, блок `panel === 'rels'` (строки 517-546)

Было:
```js
    } else if (panel === 'rels') {
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const desc   = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        if (!target) return null;
        return desc ? `${target} — ${desc}` : target;
      }).filter(Boolean);
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/relations${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        // Refresh relations view (handles "Имя — описание" and name-only)
        const rels = lines.map(l => {
          const idx = l.indexOf(' — ');
          return idx >= 0
            ? { target: l.slice(0, idx).trim(), description: l.slice(idx + 3).trim() }
            : { target: l.trim(), description: '' };
        });
        const ch = STATE.characters.find(c => c.slug === charSlug);
        if (ch) ch.relationships = rels;
        const relsHtml = rels.map(r => `
          <div class="cdet-rel">
            <div class="cdet-rel-name">${escHtml(r.target)}</div>
            <div class="cdet-rel-desc">${escHtml(r.description)}</div>
          </div>`).join('');
        document.getElementById('cdet-rels-view').innerHTML =
          relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>';
      }
```

Стало:
```js
    } else if (panel === 'rels') {
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target  = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const relType = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        const desc    = row.querySelector('.cdet-rel-desc-inp')?.value.trim() || '';
        if (!target) return null;
        const body = relType ? `[${relType}] ${desc}`.trim() : desc;
        return body ? `${target} — ${body}` : target;
      }).filter(Boolean);
      const r = await fetch(`/api/characters/${encodeURIComponent(charSlug)}/relations${qs}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }) });
      const d = await r.json();
      ok = d.ok;
      if (ok) {
        // Refresh relations view — тот же разбор «[Тип] Описание», что и на сервере (§1.1),
        // здесь дублируется для мгновенного обновления без повторного запроса персонажа.
        const rels = lines.map(l => {
          const idx = l.indexOf(' — ');
          if (idx === -1) return { target: l.trim(), relType: '', description: '' };
          const target = l.slice(0, idx).trim();
          const rest = l.slice(idx + 3).trim();
          const m = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
          return m ? { target, relType: m[1].trim(), description: m[2].trim() } : { target, relType: '', description: rest };
        });
        const ch = STATE.characters.find(c => c.slug === charSlug);
        if (ch) ch.relationships = rels;
        const relsHtml = rels.map(r => `
          <div class="cdet-rel">
            <div class="cdet-rel-name">${escHtml(r.target)}</div>
            ${r.relType ? `<div class="cdet-rel-type">${escHtml(r.relType)}</div>` : ''}
            <div class="cdet-rel-desc">${escHtml(r.description)}</div>
          </div>`).join('');
        document.getElementById('cdet-rels-view').innerHTML =
          relsHtml ? `<div class="cdet-rels-list">${relsHtml}</div>` : '<div class="cdet-empty">Нет известных связей</div>';
      }
```

### 2.6 Вкладка «Отношения» (просмотр) и вкладка «Фамильяр» — учесть `relType`

**Просмотр** (`char-detail.js`, строки 64-68) — было:
```js
  const relsHtml = (c.relationships || []).map(r => `
    <div class="cdet-rel">
      <div class="cdet-rel-name">${escHtml(r.target)}</div>
      <div class="cdet-rel-desc">${escHtml(r.description)}</div>
    </div>`).join('');
```
Стало (тот же паттерн, что §2.5 — тип отдельной строкой, только когда есть):
```js
  const relsHtml = (c.relationships || []).map(r => `
    <div class="cdet-rel">
      <div class="cdet-rel-name">${escHtml(r.target)}</div>
      ${r.relType ? `<div class="cdet-rel-type">${escHtml(r.relType)}</div>` : ''}
      <div class="cdet-rel-desc">${escHtml(r.description)}</div>
    </div>`).join('');
```

**Вкладка «Фамильяр»** (`char-detail.js`, строка 73) — было:
```js
  const familiarRel = (c.relationships || []).find(r => /фамильяр/i.test(r.description || ''));
```
Стало (новые связи хранят «Фамильяр» в `relType`, не в `description` — старые продолжают
находиться по `description`, как раньше):
```js
  const familiarRel = (c.relationships || []).find(r =>
    /фамильяр/i.test(r.relType || '') || /фамильяр/i.test(r.description || ''));
```

---

## §3. Граф — предпочитать точное совпадение по `relType`

`web/routes/dashboard.js`, `matchRelType` (введена в Фазе 1, строки 87-90) — сейчас всегда
сравнивает подстрокой с `description`. С появлением `relType` нужно сначала проверить **точное**
совпадение по нему (надёжнее подстрочного) и только потом падать на подстрочный разбор
`description` (для легаси-записей без `relType`).

Было:
```js
    function matchRelType(desc) {
      const d = (desc || '').toLowerCase();
      return sortedRelTypes.find(t => d.includes(t.name.toLowerCase())) || null;
    }
```
Стало:
```js
    function matchRelType(relType, desc) {
      if (relType) {
        const rt = relType.toLowerCase();
        const exact = sortedRelTypes.find(t => t.name.toLowerCase() === rt);
        if (exact) return exact;
      }
      const d = (desc || '').toLowerCase();
      return sortedRelTypes.find(t => d.includes(t.name.toLowerCase())) || null;
    }
```
Вызов (строка 124) — было `matchRelType(r.description)`, стало `matchRelType(r.relType, r.description)`.

Заодно — метка ребра (строка 123) уже сегодня усечена эвристикой по `;`; когда есть `relType`,
он короче и точнее любой эвристики над свободным текстом:
```js
        const label = r.relType || r.description.split(';')[0].slice(0, 55);
```

---

## §4. CSS — `web/public/styles.css`

Строка `.cdet-rel-row` (3751-3755) — было `display: flex`, теперь строка стала двухуровневой
(шапка + описание снизу):
```css
.cdet-rel-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
```
Новые правила (рядом, после существующего блока `.cdet-rel-name-inp, .cdet-rel-type-inp`,
строки 3791-3807 — оставить как есть, они всё ещё применяются к полям внутри шапки):
```css
.cdet-rel-row-top {
  display: flex;
  gap: 8px;
  align-items: center;
}
.cdet-rel-type-pick-btn {
  background: none; border: 1px solid var(--border); border-radius: 5px;
  color: var(--text3); cursor: pointer; padding: 6px 8px; flex-shrink: 0;
}
.cdet-rel-type-pick-btn:hover { color: var(--text); border-color: var(--accent2); }
.cdet-rel-desc-inp {
  width: 100%; box-sizing: border-box;
  background: var(--bg); color: var(--text); border: 1px solid var(--border);
  border-radius: 5px; padding: 8px 10px; font-family: var(--f-body); font-size: var(--fs-sm);
  resize: vertical;
}
.cdet-rel-desc-inp:focus { border-color: var(--gold); box-shadow: 0 0 6px var(--glow); }
.cdet-rel-type {
  color: var(--gold); font-size: var(--fs-sm); font-style: italic;
}
```
`.cdet-rel-name-inp` (`flex: 0 0 38%`) внутри `.cdet-rel-row-top` теперь конкурирует за место с
новой кнопкой 📚 — при 38%+auto(кнопки)+flex:1(тип) на узких экранах может потребоваться
уменьшить долю имени (например до 32%) или перенести кнопку под тип — точная подстройка вёрстки
оставлена на живую проверку в браузере при реализации, не фиксирую точное число здесь.

---

## §5. Краевые случаи

- **Тип указан, описание пустое** — `[Тип]` без хвоста, парсится как `relType='Тип'`,
  `description=''`. Отображается только тип (просмотр §2.6 показывает `.cdet-rel-desc` пустым
  блоком — визуально приемлемо, аналогично тому, как остальные необязательные поля карточки уже
  ведут себя пустыми).
- **Легаси-строка, начинающаяся с `[`** (то есть где старый пользователь сам когда-то написал
  «[что-то] текст» как часть вольного описания) — с этой техспекой такая строка ошибочно
  распознается как структурная (`relType` = «что-то»). Осознанный, принятый в анализе риск (см.
  §1) — не встречалось в реальных данных проекта на момент анализа, не блокирует реализацию.
- **`_activeRelTypeInput` ссылается на удалённую строку** (пользователь открыл пикер у строки,
  затем удалил именно эту строку, не закрыв пикер) — клик по элементу списка попытается
  записать в `.value` уже отсоединённого от DOM `<input>` — операция безопасна (JS не бросает
  на detached-элементе), просто результат никуда не попадёт визуально; сама панель-пикер при
  этом остаётся видимой в DOM (переехала за строкой, которой больше нет) — до следующего клика
  по любому 📚 она просто переедет на актуальную строку. Незначительный, не крашащий край;
  специально не устраняется в этой техспеке.

## §6. Тест-план

- **`npm test`** — добавить/обновить юнит-тест парсера (`web/tests/all.test.js`, рядом с
  существующими тестами `parseCharacter`/связей): карточка со строкой
  `- Джуди — [Союзник] доверенное лицо` → `relationships[0]` содержит `relType: 'Союзник'`,
  `description: 'доверенное лицо'`, `type: 'ally'` (categorizeRel по «Союзник» уже сегодня даёт
  `ally` — regex `/союзник|друг|доверя|помощ|поддерж/`). Легаси-строка без скобок → `relType: ''`,
  `type` — прежнее поведение классификатора.
- **Регресс существующих тестов на связи** — прогнать полный набор, ожидается 713/713 без
  падений (формат обратно совместим, ни один существующий тест не создаёт строк с `[...]` в
  начале описания).
- **Живая проверка** (`run-sanguine-web`): открыть карточку персонажа-вампира → «Отношения» →
  редактирование → добавить связь с типом из пикера (📚) + развёрнутым описанием → сохранить →
  просмотр показывает тип и описание раздельно → открыть карточку заново (полная перезагрузка) —
  сохранённое значение читается корректно с диска. Отдельно — легаси-персонаж с уже
  существующими (Фаза-1-эры) связями без типа: открыть/отредактировать/сохранить не ломает
  старые записи. Отдельно — граф: связь с типом «Союзник» (или другим из «Постоянных связей»)
  красится точным цветом библиотеки; связь без типа, но с текстом, содержащим слово «союзник» —
  по-прежнему красится тем же цветом через фоллбэк на подстрочный разбор `description` (проверка
  §3, что переход на точное совпадение не сломал уже работавший подстрочный фоллбэк).

## §7. Порядок реализации

§1 (парсер) → §2 (форма) → §2.6 (просмотр/фамильяр) → §3 (граф) → §4 (CSS) → §6 (тесты). Не
делится на подэтапы — все части вместе составляют одну согласованную единицу формата, частичное
внедрение (например §1 без §2) оставило бы форму несовместимой с уже читаемыми данными.
