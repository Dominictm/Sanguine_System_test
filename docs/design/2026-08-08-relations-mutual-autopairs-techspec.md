# Техспека (Фаза 3): «Взаимно» + авто-пары Сир/Чайлд · Брат/Сестра · Домитор/Гуль

**Роль:** Системный аналитик · **Дата:** 2026-08-08
**Источник:** [2026-08-08-relations-management-analysis.md](2026-08-08-relations-management-analysis.md)
(Аналитик, §«П.4-7», развилка №4 — «Вариант A: явный маркер в данных»), поверх уже сданных
Фазы 1 (библиотека «Постоянные связи») и Фазы 2 (разделение поля на тип/описание,
[2026-08-08-relations-field-split-techspec.md](2026-08-08-relations-field-split-techspec.md)).

## §0. Границы

Реализует п.4-7 запроса. Формат хранения, введённый Фазой 2 (`Имя — [Тип] Описание`),
расширяется ЕЩЁ ОДНИМ необязательным маркером — признаком взаимности. Ничего в Фазах 1/2 не
меняется по сути, только добавляется.

**Ключевое архитектурное решение (уже принято в анализе)**: признак взаимности — явный,
хранимый маркер в данных, а не выводимый по совпадению строк на двух карточках. Без этого
редактирование/удаление ранее-взаимной связи без повторного включения чекбокса «развязало» бы
стороны незаметно для пользователя (см. анализ, развилка №4).

**Авто-пары — константа в коде, не поле библиотеки «Постоянные связи».** Рассматривался вариант
хранить пару (`pairType`) как поле библиотечной записи — отклонён: запрос перечисляет ровно три
фиксированные пары, ничего не просит о пользовательских правилах «мой тип X зеркалится в мой тип
Y» — добавление такого поля/UI для его редактирования было бы абстракцией сверх того, что
требует задача. Три пары — обычная константа, тот же принцип, что уже применён к
`categorizeRel`/`REL_COLORS` в этой же кодовой базе.

---

## §1. Формат хранения — маркер `↔` перед `[Тип]`

Было (Фаза 2): `Имя — [Тип] Описание` или `Имя — Описание`.
Стало: **необязательный** префикс `↔ ` (стрелка + пробел) перед всем остальным — комбинируется
с типом независимо (взаимность и тип — ортогональные признаки):

| Комбинация | Строка в MD |
|---|---|
| Не взаимно, без типа (как сегодня) | `Имя — Описание` |
| Не взаимно, с типом (Фаза 2) | `Имя — [Тип] Описание` |
| **Взаимно, без типа** | `Имя — ↔ Описание` |
| **Взаимно, с типом** | `Имя — ↔ [Тип] Описание` |

`↔` (U+2194) выбран по тому же принципу, что `[` в Фазе 2 — практически не встречается в
начале свободного текста связей естественным образом, минимальный риск ложного срабатывания на
легаси-данных.

### 1.1 Парсер — `web/lib/parsers/character.js`, блок `relBlock` (после правки Фазы 2)

Было:
```js
      const rest = clean.slice(dash + 3).trim();
      const typeMatch = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
      const relType = typeMatch ? typeMatch[1].trim() : '';
      const desc    = typeMatch ? typeMatch[2].trim() : rest;
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, relType, type: categorizeRel(relType || desc) });
      }
```
Стало:
```js
      const rest0 = clean.slice(dash + 3).trim();
      // Взаимность (2026-08-08, Фаза 3) — необязательный маркер ↔ перед всем остальным,
      // независим от [Тип]. Порядок разбора: сначала ↔, потом [Тип] — раз маркер взаимности
      // всегда идёт первым в самой строке (см. §1 техспеки).
      let mutual = false;
      let rest = rest0;
      if (rest.startsWith('↔')) { mutual = true; rest = rest.slice(1).trim(); }
      const typeMatch = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
      const relType = typeMatch ? typeMatch[1].trim() : '';
      const desc    = typeMatch ? typeMatch[2].trim() : rest;
      for (const tgt of targets) {
        c.relationships.push({ target: tgt, description: desc, relType, mutual, type: categorizeRel(relType || desc) });
      }
```
JSDoc `@returns` (строка с `relationships: {...}[]`) — добавить `mutual: boolean` в перечисление
полей.

---

## §2. Форма редактирования — чекбокс «Взаимно» + авто-пары

### 2.1 `_relRowHtml` (`web/public/scripts/scripts.js`) — четвёртый параметр

Было (Фаза 2):
```js
function _relRowHtml(target = '', relType = '', description = '') {
  return `<div class="cdet-rel-row">
    <div class="cdet-rel-row-top">
      <input class="cdet-rel-name-inp" list="cdet-rel-names" placeholder="Имя персонажа" value="${escAttr(target)}">
      <div class="cdet-field-with-pick">
        <input class="cdet-rel-type-inp" placeholder="Вид отношений" value="${escAttr(relType)}">
        <button type="button" class="cdet-lib-pick-btn" data-pick-rel-type="1" title="Выбрать из библиотеки" aria-label="Выбрать вид отношений из библиотеки">📚</button>
      </div>
      <button class="cdet-rel-del-btn" type="button" title="Удалить связь">✕</button>
    </div>
    <textarea class="cdet-rel-desc-inp" placeholder="Развёрнутое описание (необязательно)" rows="2">${escHtml(description)}</textarea>
  </div>`;
}
```
Стало:
```js
function _relRowHtml(target = '', relType = '', description = '', mutual = false) {
  return `<div class="cdet-rel-row">
    <div class="cdet-rel-row-top">
      <input class="cdet-rel-name-inp" list="cdet-rel-names" placeholder="Имя персонажа" value="${escAttr(target)}">
      <div class="cdet-field-with-pick">
        <input class="cdet-rel-type-inp" placeholder="Вид отношений" value="${escAttr(relType)}">
        <button type="button" class="cdet-lib-pick-btn" data-pick-rel-type="1" title="Выбрать из библиотеки" aria-label="Выбрать вид отношений из библиотеки">📚</button>
      </div>
      <button class="cdet-rel-del-btn" type="button" title="Удалить связь">✕</button>
    </div>
    <label class="cdet-rel-mutual">
      <input type="checkbox" class="cdet-rel-mutual-cb"${mutual ? ' checked' : ''}> Взаимно
    </label>
    <textarea class="cdet-rel-desc-inp" placeholder="Развёрнутое описание (необязательно)" rows="2">${escHtml(description)}</textarea>
  </div>`;
}
```
Все три вызова `_relRowHtml(...)` в `char-detail.js` (рендер строк при входе в редактирование,
пересборка при повторном входе, `+ Добавить связь` — уже добавляет 4-й аргумент по умолчанию
`false` для новой пустой строки без изменений) — добавить четвёртый аргумент `r.mutual` в первые
два (там, где строится по уже загруженным `r`), третий (кнопка «+ Добавить связь») не менять —
новая строка создаётся `_relRowHtml()` без аргументов, `mutual` по умолчанию `false` уже
соответствует «по умолчанию не активен» из запроса.

### 2.2 Авто-пары — константа + авто-чекбокс (`char-detail.js`)

```js
// Авто-парные типы связей (2026-08-08, Фаза 3, п.5-7 запроса) — выбор одного из них включает
// «Взаимно» автоматически. Копия той же логики на сервере (web/routes/characters.js,
// REL_AUTO_PAIRS) — держать в синхроне при правках; здесь нужен только факт «это авто-парный
// тип», не сама пара (сервер сам считает зеркальный тип при сохранении).
const REL_AUTO_PAIR_TYPES = new Set(['сир', 'чайлд', 'брат', 'сестра', 'гуль', 'домитор']);
function _relSyncAutoMutual(row) {
  const typeInp = row?.querySelector('.cdet-rel-type-inp');
  const mutualCb = row?.querySelector('.cdet-rel-mutual-cb');
  if (!typeInp || !mutualCb) return;
  if (REL_AUTO_PAIR_TYPES.has(typeInp.value.trim().toLowerCase())) mutualCb.checked = true;
}
```
Вызывается из двух мест:
1. **Ручной ввод типа** — добавить в существующий `document.addEventListener('input', ...)`
   (там же, где уже обрабатывается `cdet-rel-type-search`, Фаза 2):
   ```js
   if (e.target.matches('.cdet-rel-type-inp')) _relSyncAutoMutual(e.target.closest('.cdet-rel-row'));
   ```
2. **Выбор из пикера** — в существующем клик-делегате (Фаза 2, ветка `relTypeItem`), сразу после
   `if (_activeRelTypeInput) _activeRelTypeInput.value = relTypeItem.dataset.name || '';`:
   ```js
   _relSyncAutoMutual(_activeRelTypeInput?.closest('.cdet-rel-row'));
   ```
Чекбокс остаётся переключаемым вручную и после авто-простановки — запрос требует автоматической
простановки при выборе типа, не блокировки ручного снятия; пользователь может сознательно
отменить взаимность даже для Сир/Чайлд (например, зафиксировать факт создания без немедленного
изменения карточки чайлда — тот тоже сможет включить взаимность позже сам).

### 2.3 Сбор строк при сохранении (`char-detail.js`, блок `panel === 'rels'`)

Было (Фаза 2):
```js
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target  = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const relType = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        const desc    = row.querySelector('.cdet-rel-desc-inp')?.value.trim() || '';
        if (!target) return null;
        const body = relType ? `[${relType}] ${desc}`.trim() : desc;
        return body ? `${target} — ${body}` : target;
      }).filter(Boolean);
```
Стало:
```js
      const lines = Array.from(document.querySelectorAll('#cdet-rels-rows .cdet-rel-row')).map(row => {
        const target  = row.querySelector('.cdet-rel-name-inp')?.value.trim() || '';
        const relType = row.querySelector('.cdet-rel-type-inp')?.value.trim() || '';
        const desc    = row.querySelector('.cdet-rel-desc-inp')?.value.trim() || '';
        const mutual  = row.querySelector('.cdet-rel-mutual-cb')?.checked || false;
        if (!target) return null;
        let body = relType ? `[${relType}] ${desc}`.trim() : desc;
        if (mutual) body = `↔ ${body}`.trim();
        return body ? `${target} — ${body}` : target;
      }).filter(Boolean);
```

Ответ сервера теперь может включать `warnings` (см. §4) — после существующего `ok = d.ok;`
добавить:
```js
      if (d.warnings?.length) showToast(d.warnings.join('; '), 'warning');
```

Клиентский разбор для мгновенного обновления просмотра (тот же блок, чуть ниже) — добавить
разбор `↔` перед `[Тип]`, тем же способом, что в §1.1:
```js
        const rels = lines.map(l => {
          const idx = l.indexOf(' — ');
          if (idx === -1) return { target: l.trim(), relType: '', description: '', mutual: false };
          const target = l.slice(0, idx).trim();
          let rest = l.slice(idx + 3).trim();
          let mutual = false;
          if (rest.startsWith('↔')) { mutual = true; rest = rest.slice(1).trim(); }
          const m = rest.match(/^\[([^\]]+)\]\s*(.*)$/);
          return m ? { target, relType: m[1].trim(), description: m[2].trim(), mutual } : { target, relType: '', description: rest, mutual };
        });
```

### 2.4 Просмотр — бейдж взаимности (`char-detail.js`, оба места, редактирование-вход и
просмотр верхнего уровня — та же правка в обоих)

Было (Фаза 2):
```js
      ${r.relType ? `<div class="cdet-rel-type">${escHtml(r.relType)}</div>` : ''}
```
Стало:
```js
      ${(r.relType || r.mutual) ? `<div class="cdet-rel-type">${r.mutual ? '<span class="cdet-rel-mutual-badge" title="Взаимная связь">↔</span> ' : ''}${escHtml(r.relType)}</div>` : ''}
```

---

## §3. CSS — `web/public/styles.css`

```css
.cdet-rel-mutual {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text2);
  cursor: pointer;
}
.cdet-rel-mutual-badge {
  color: var(--gold);
  font-size: var(--fs-sm);
}
```

---

## §4. Сервер — взаимная синхронизация (`web/routes/characters.js`)

### 4.1 Авто-парные типы — константа

```js
// Авто-парные типы связей (2026-08-08, Фаза 3, п.5-7 запроса) — при взаимной синхронизации
// зеркальная сторона получает НЕ тот же тип, а парный (Сир↔Чайлд, Домитор↔Гуль); Брат/Сестра —
// в зависимости от пола ЦЕЛИ (кому пишем зеркальную строку). Остальные типы (включая «Семья»,
// «Союзник» и любой авторский) зеркалятся тем же именем — симметричны по умолчанию. Копия той
// же логики есть в scripts.js (REL_AUTO_PAIR_TYPES, для авто-чекбокса формы) — держать в
// синхроне при правках.
const REL_AUTO_PAIRS = { 'сир': 'Чайлд', 'чайлд': 'Сир', 'домитор': 'Гуль', 'гуль': 'Домитор' };
const REL_GENDER_PAIR_KEYS = new Set(['брат', 'сестра']);
function _relMirrorType(relType, targetGender) {
  const key = (relType || '').trim().toLowerCase();
  if (!key) return '';
  if (REL_GENDER_PAIR_KEYS.has(key)) {
    if (targetGender === 'Мужской') return 'Брат';
    if (targetGender === 'Женский') return 'Сестра';
    return relType; // пол цели неизвестен (легаси-карточка без «Пол») — зеркалим тем же словом
  }
  return REL_AUTO_PAIRS[key] || relType;
}
```

### 4.2 Сериализация строки + вынесенная запись блока «Отношения»

Существующая логика записи блока (сейчас — inline в самом роуте) выносится в переиспользуемую
функцию — она же нужна для записи зеркальной строки в карточку цели.

```js
function _serializeRelationLine(target, relType, description, mutual) {
  let body = relType ? `[${relType}] ${description || ''}`.trim() : (description || '').trim();
  if (mutual) body = `↔ ${body}`.trim();
  return body ? `${target} — ${body}` : target;
}

// Перезаписывает секцию «Отношения» уже загруженного персонажа целиком новым набором строк.
// Используется и для основного персонажа при обычном сохранении (§4.3), и для цели при
// зеркальной записи «Взаимно» (§4.4) — во втором случае трогает ТОЛЬКО эту секцию, остальные
// поля карточки цели не читает и не пишет.
async function _writeRelationsBlock(city, char, lines) {
  const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
  let card = await fs.readFile(cardPath, 'utf-8');
  const bullets = lines.map(sanitizeInlineText).filter(Boolean).map(l => `  - ${l}`).join('\n');
  const newBlock = `- **Отношения:**\n${bullets || '  - —'}`;
  const relRe = /- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/;
  if (relRe.test(card)) {
    card = card.replace(relRe, newBlock + '\n');
  } else {
    const insertBefore = card.indexOf('- **🎨');
    if (insertBefore !== -1) card = card.slice(0, insertBefore) + newBlock + '\n' + card.slice(insertBefore);
  }
  await writeFileAtomic(cardPath, card, 'utf-8');
}
```

### 4.3 Основной роут — было/стало

Было:
```js
  router.put('/api/characters/:slug/relations', express.json(), async (req, res) => {
    try {
      const slug   = decodeURIComponent(req.params.slug);
      const city   = reqCity(req);
      const lines  = req.body.lines || []; // array of strings "Имя — описание"

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const cardPath = path.join(charsDir(city), char.lineageFolder, char.slug, `${char.slug}.md`);
      let card = await fs.readFile(cardPath, 'utf-8');
      const bullets = lines.map(sanitizeInlineText).filter(Boolean).map(l => `  - ${l}`).join('\n');
      const newBlock = `- **Отношения:**\n${bullets || '  - —'}`;
      const relRe = /- \*\*Отношения:\*\*\n((?:[ \t]+- .+\n?)+)/;
      if (relRe.test(card)) {
        card = card.replace(relRe, newBlock + '\n');
      } else {
        const insertBefore = card.indexOf('- **🎨');
        if (insertBefore !== -1) {
          card = card.slice(0, insertBefore) + newBlock + '\n' + card.slice(insertBefore);
        }
      }

      await writeFileAtomic(cardPath, card, 'utf-8');
      invalidateChars(city);
      res.json({ ok: true });
    } catch (e) {
      serverError(res, e);
    }
  });
```

Стало:
```js
  router.put('/api/characters/:slug/relations', express.json(), async (req, res) => {
    try {
      const slug   = decodeURIComponent(req.params.slug);
      const city   = reqCity(req);
      const lines  = req.body.lines || []; // array of strings "Имя — [↔][Тип] описание"

      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });
      const oldRels = char.relationships || [];

      await _writeRelationsBlock(city, char, lines);
      invalidateChars(city);

      // Взаимная синхронизация (2026-08-08, Фаза 3, п.4-7) — сравнить СТАРОЕ/НОВОЕ состояние
      // relationships этого персонажа (по признаку mutual), разойтись по карточкам целей.
      const freshChars = await getAllCharacters(city);
      const freshChar  = freshChars.find(c => c.slug === slug);
      const warnings = await _syncMutualRelations(city, freshChars, char.name, oldRels, freshChar?.relationships || []);

      res.json({ ok: true, warnings });
    } catch (e) {
      serverError(res, e);
    }
  });
```

### 4.4 `_syncMutualRelations` — сравнение и точечная правка карточек целей

```js
// Взаимная синхронизация (2026-08-08, Фаза 3, п.4-7) — НЕ рекурсивна: запись зеркальной строки
// в карточку цели не запускает эту же функцию повторно для цели (иначе бесконечный каскад при
// A↔B↔A) — это точечная правка ТОЛЬКО секции «Отношения» цели через _writeRelationsBlock,
// в обход основного роута. Сопоставление персонажа-цели по имени — ТОЧНОЕ (Map по c.name), не
// нечёткое, в отличие от резолвера графа (dashboard.js) — там неточный матч влияет только на
// отображение ребра, здесь — на то, В КАКОЙ ФАЙЛ будет произведена запись; ошибка недопустима.
async function _syncMutualRelations(city, chars, aName, oldRels, newRels) {
  const warnings = [];
  const byName = new Map(chars.map(c => [c.name, c]));

  const oldMutual = new Map(oldRels.filter(r => r.mutual).map(r => [r.target, r]));
  const newMutual = new Map(newRels.filter(r => r.mutual).map(r => [r.target, r]));

  // Выбывшие: были взаимными до этого сохранения, сейчас — нет (сняли чекбокс, сменили
  // цель/тип или удалили строку целиком).
  for (const [targetName] of oldMutual) {
    if (newMutual.has(targetName)) continue;
    const target = byName.get(targetName);
    if (!target) continue; // персонаж-цель удалён/переименован между сохранениями — нечего чистить
    try {
      const fresh = await getAllCharacters(city);
      const tChar = fresh.find(c => c.slug === target.slug);
      if (!tChar) continue;
      const kept = (tChar.relationships || []).filter(r => !(r.mutual && r.target === aName));
      await _writeRelationsBlock(city, tChar, kept.map(r => _serializeRelationLine(r.target, r.relType, r.description, r.mutual)));
      invalidateChars(city);
    } catch (e) {
      warnings.push(`Не удалось снять взаимную связь у «${targetName}»: ${e.message}`);
    }
  }

  // Новые/изменившиеся: добавить или обновить зеркальную строку у цели.
  for (const [targetName, rel] of newMutual) {
    if (targetName === aName) { warnings.push('Связь «Взаимно» на самого себя проигнорирована'); continue; }
    const target = byName.get(targetName);
    if (!target) { warnings.push(`«${targetName}» не найден(а) среди персонажей — взаимная связь не создана`); continue; }
    try {
      const fresh = await getAllCharacters(city);
      const tChar = fresh.find(c => c.slug === target.slug);
      if (!tChar) continue;
      const mirrorType = _relMirrorType(rel.relType, tChar.gender);
      const nextRels = [...(tChar.relationships || [])];
      const idx = nextRels.findIndex(r => r.mutual && r.target === aName);
      // Описание НЕ копируется зеркально — текст с точки зрения A часто грамматически не
      // подходит от лица B («она мне доверяет» не читается как «я доверяю ей»); тип несёт
      // основной смысл связи, описание со стороны B персонаж/Рассказчик дописывает сам.
      const mirrorEntry = { target: aName, relType: mirrorType, description: '', mutual: true };
      if (idx === -1) nextRels.push(mirrorEntry); else nextRels[idx] = mirrorEntry;
      await _writeRelationsBlock(city, tChar, nextRels.map(r => _serializeRelationLine(r.target, r.relType, r.description, r.mutual)));
      invalidateChars(city);
    } catch (e) {
      warnings.push(`Не удалось создать взаимную связь с «${targetName}»: ${e.message}`);
    }
  }
  return warnings;
}
```

Свежее чтение `getAllCharacters(city)` внутри каждой итерации (а не переиспользование внешнего
`chars`) — на случай, если ДВЕ взаимные строки в одном сохранении указывают на ОДНОГО и того же
персонажа (редкий, но возможный краевой случай) — вторая правка должна видеть результат первой,
не перезаписать его.

---

## §5. Краевые случаи

- **Однонаправленная связь без чекбокса** (текущее поведение Фаз 1-2) — не меняется вообще,
  `mutual=false` по всей цепочке, `_syncMutualRelations` для такой строки не делает ничего.
- **Взаимно + цель не найдена** (опечатка в имени/персонаж ещё не заведён) — связь у ИСХОДНОГО
  персонажа всё равно сохраняется как обычно (с маркером `↔` в тексте), только зеркальная запись
  не создаётся — предупреждение в `warnings`, не ошибка, не блокирует сохранение остального.
- **Пол цели не указан** (легаси-карточка) при авто-паре Брат/Сестра — зеркалим тем же словом,
  что ввёл пользователь (не гадаем), без предупреждения — это не поломка, а разумный фоллбэк.
- **Пользователь вручную вписал тип «Сир», не выбирая из пикера** — авто-чекбокс всё равно
  срабатывает (§2.2 сверяет введённое значение по нижнему регистру, не факт выбора из списка) —
  соответствует «выбор подобной связи», а не только «выбор через 📚».
- **Два независимых взаимных набора A↔B и A↔C одновременно** — каждая пара обрабатывается
  независимо, не мешают друг другу (нет общего состояния между итерациями цикла §4.4, кроме
  случая одной и той же цели, см. §4.4 конец).
- **Обратная совместимость** — легаси-строки (Фазы 1/2 или ещё старше) парсятся с `mutual:
  false`, поведение не меняется, миграция не нужна (тот же принцип, что и в Фазе 2).

## §6. Тест-план

- **Юнит-тест парсера** (`web/tests/all.test.js`, рядом с тестами Фазы 2): строка
  `- Джуди — ↔ [Сир] обратила меня` → `relationships[0]` = `{ target: 'Джуди', description:
  'обратила меня', relType: 'Сир', mutual: true, type: 'sire' }`. Строка без `↔` — `mutual: false`.
- **Интеграционный тест синхронизации** (по образцу уже существующего теста для
  `syncPoliticalCharacterHierarchy`, `describe('city-creation-restructure: …')` — тот же дух,
  здесь свой `describe`): создать двух персонажей A (без пола — не важно) и Б (`gender:
  'Мужской'`) → `PUT /api/characters/:aSlug/relations` со строкой `«Б — ↔[Сир] обратила»` →
  проверить, что `GET /api/characters` для Б содержит `relationships` с `{target: 'A', relType:
  'Чайлд', mutual: true}` → повторный `PUT` для A без `↔` (сняли взаимность) → проверить, что у
  Б зеркальная строка исчезла, а остальные (если были) не тронуты. Отдельный кейс — Брат/Сестра:
  создать персонажа с `gender: 'Женский'`, взаимная связь «Брат» → зеркальная сторона получает
  «Сестра».
- **Живая проверка** (`run-sanguine-web`): открыть карточку A → «Отношения» → редактирование →
  выбрать тип «Сир» из пикера у связи на Б → убедиться, что чекбокс «Взаимно» включился
  автоматически → сохранить → открыть карточку Б → убедиться, что появилась связь на A с типом
  «Чайлд» и бейджем ↔. Снять чекбокс у A, сохранить → у Б связь пропала.
- Регресс — `npm test` целиком, 715+/715+, обратная совместимость Фаз 1/2 не нарушена.

## §7. Порядок реализации

§1 (парсер) → §2 (форма) → §3 (CSS) → §4 (сервер) — сервер зависит от формата из §1 и от того,
что клиент (§2) уже умеет присылать `↔`; тестировать сквозной сценарий имеет смысл только после
всех четырёх частей вместе, частичное внедрение бессмысленно (как и в Фазе 2).
