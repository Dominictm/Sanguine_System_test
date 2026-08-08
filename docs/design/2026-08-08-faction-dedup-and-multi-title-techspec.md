# Техспека: дедупликация пикеров фракций города + мульти-титулы персонажа

**Роль:** Системный аналитик · **Дата:** 2026-08-08
**Источник:** [`2026-08-08-faction-picker-dedup-and-multi-title-analysis.md`](2026-08-08-faction-picker-dedup-and-multi-title-analysis.md) (Аналитик)

Три пункта исходного запроса → две части этой техспеки (третий пункт уже реализован,
изменений не требует):

| # | Запрос | Статус | Часть |
|---|---|---|---|
| 1 | Пикеры фракций города не должны показывать уже добавленное | Гэп — есть решение | **Часть 7** |
| 2 | Мульти-выбор титулов персонажа (как у дисциплин) | Гэп — есть решение + бэкенд-риск | **Часть 8** |
| 3 | Клановый фильтр для дисциплин (как секта у титулов) | **Уже реализовано**, действий нет | — |

Часть 3 подтверждена в анализе: `_renderDisciplinePickerLists` (`char-detail.js:1422-1449`)
уже строит группы «Клановые»/«Все дисциплины» ровно по этой логике. В тест-плане ниже —
только regression-подтверждение, без правок кода.

---

## Часть 7 — Дедупликация пикеров фракций города

### 7.1 Контекст

`web/public/scripts/city.js`, функция `_renderFactionPickerList(which, query)`
(строки 753–780) — общая точка рендера четырёх панелей-пикеров (`sects`/`clans`/`mortal`/
`state`), вызывается из трёх мест: открытие панели (клик 📚, строка 787), ввод в поиск
(строка 822), и (добавляется этой техспекой) после add/remove. Сейчас список кандидатов
фильтруется только по поисковому запросу — уже добавленные записи остаются в списке.

### 7.2 Изменения

**7.2.1 Новый хелпер — `_factionAlreadyAdded(which)`** (добавить перед
`_renderFactionPickerList`, после `_collectFactionsState` или рядом с `_collectFactions`):

```js
// Множество уже добавленных имён для конкретного раздела пикера — источник совпадает с тем,
// что читают _collectFactions*/_collectFactionsMortal/_collectFactionsState на сохранении,
// но здесь нужен именно Set имён, а не сериализованная строка.
function _factionAlreadyAdded(which) {
  if (which === 'sects' || which === 'clans') {
    return new Set(Array.from(
      document.querySelectorAll(`.cdet-faction-chips[data-faction-group="${which}"] .cdet-faction-chip`)
    ).map(b => b.dataset.faction));
  }
  const field = which === 'mortal' ? 'factions-mortal-list' : 'factions-state-list';
  const ta = document.querySelector(`[data-city-field="${field}"]`);
  return new Set((ta?.value || '').split('\n').map(l => l.trim()).filter(Boolean));
}
```

**7.2.2 `_renderFactionPickerList`** — добавить фильтр по `_factionAlreadyAdded(which)` в
каждую из четырёх ветвей (строки 753–780):

```js
async function _renderFactionPickerList(which, query) {
  const q = (query || '').toLowerCase();
  const added = _factionAlreadyAdded(which);
  const itemHtml = r => `<button type="button" class="v20-lib-item" data-name="${escAttr(r.name)}"><span>${escHtml(r.name)}</span></button>`;
  if (which === 'sects') {
    await ensureSects();
    const list = (_sectsCache || []).filter(s => !added.has(s.name) && (!q || s.name.toLowerCase().includes(q)));
    document.getElementById('cdet-faction-sects-list').innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
  } else if (which === 'clans') {
    await ensureClans();
    const list = (_clansCache || []).filter(c => c.sect === 'Независимые' && !added.has(c.name) && (!q || c.name.toLowerCase().includes(q)));
    document.getElementById('cdet-faction-clans-list').innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
  } else if (which === 'mortal') {
    const groups = ['religious', 'crime', 'civic'];
    await Promise.all(groups.map(ensureMortLib));
    for (const g of groups) {
      const full = _mortLibCache.get(g) || [];
      const list = full.filter(r => !added.has(r.name) && (!q || r.name.toLowerCase().includes(q)));
      const groupEl = document.querySelector(`#cdet-faction-mortal-picker .cdet-lib-picker-group[data-group="${g}"]`);
      if (groupEl) groupEl.style.display = full.length ? '' : 'none';
      const listEl = document.getElementById(`cdet-faction-mortal-list-${g}`);
      if (listEl) listEl.innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
    }
  } else if (which === 'state') {
    await ensureMortLib('government');
    const list = (_mortLibCache.get('government') || []).filter(r => !added.has(r.name) && (!q || r.name.toLowerCase().includes(q)));
    document.getElementById('cdet-faction-state-list').innerHTML = list.map(itemHtml).join('') || '<div class="cdet-empty">Ничего не найдено.</div>';
  }
}
```

(правки — только добавленный `!added.has(r.name) &&`/`!added.has(s.name) &&`/
`!added.has(c.name) &&` в четырёх фильтрах; `groupEl.style.display` логика по `full.length`
остаётся без изменений — пустота групп по фильтру библиотеки и пустота по «всё уже
добавлено» — разные вещи, первую продолжаем скрывать целиком, вторая просто даст пустой
список с «Ничего не найдено», это ожидаемо и корректно.)

**7.2.3 Перерисовка после add/remove** — сейчас после клика по элементу списка
(строки 792–813) и по чипу (817–818) панель не перерисовывается. Добавить:

```js
document.addEventListener('click', async e => {
  const pickBtn = e.target.closest('[data-pick-faction]');
  if (pickBtn) { /* без изменений */ }

  const item = e.target.closest('.v20-lib-picker[id^="cdet-faction-"] .v20-lib-item');
  if (item) {
    const picker = item.closest('.v20-lib-picker');
    const which = picker.id.replace('cdet-faction-', '').replace('-picker', '');
    const name = item.dataset.name;
    if (which === 'sects' || which === 'clans') {
      /* существующий toggle чипов — без изменений */
    } else {
      /* существующий toggle строк textarea — без изменений */
    }
    // НОВОЕ: только что добавленная/убранная запись должна сразу пропасть/вернуться в списке.
    const searchInput = document.getElementById(`cdet-faction-${which}-search`);
    await _renderFactionPickerList(which, searchInput?.value || '');
    return;
  }

  const chip = e.target.closest('.cdet-faction-chip');
  if (chip) {
    // НОВОЕ: определить группу и перерисовать её пикер (если открыт), ДО удаления чипа
    // (после удаления _factionAlreadyAdded уже не увидит убранное имя среди чипов).
    const which = chip.closest('.cdet-faction-chips')?.dataset.factionGroup;
    chip.remove();
    if (which) {
      const picker = document.getElementById(`cdet-faction-${which}-picker`);
      if (picker && !picker.hidden) {
        const searchInput = document.getElementById(`cdet-faction-${which}-search`);
        await _renderFactionPickerList(which, searchInput?.value || '');
      }
    }
    return;
  }
});
```

**7.2.4 Ручная правка textarea держит пикер в синхроне** (mortal/state — единственные два
раздела без чипов; пользователь может дописать строку руками, не через 📚) — расширить
существующий `input`-делегат (строки 820–823):

```js
document.addEventListener('input', e => {
  const m = /^cdet-faction-(sects|clans|mortal|state)-search$/.exec(e.target.id || '');
  if (m) _renderFactionPickerList(m[1], e.target.value);

  // НОВОЕ: правка textarea вручную — если соответствующий пикер открыт, список должен
  // сразу учитывать вписанную строку (иначе она продолжит маячить в списке выбора до
  // следующего открытия/поиска панели).
  if (e.target.matches('[data-city-field="factions-mortal-list"]')) {
    const picker = document.getElementById('cdet-faction-mortal-picker');
    if (picker && !picker.hidden) _renderFactionPickerList('mortal', document.getElementById('cdet-faction-mortal-search')?.value || '');
  }
  if (e.target.matches('[data-city-field="factions-state-list"]')) {
    const picker = document.getElementById('cdet-faction-state-picker');
    if (picker && !picker.hidden) _renderFactionPickerList('state', document.getElementById('cdet-faction-state-search')?.value || '');
  }
});
```

### 7.3 Краевые случаи

- Панель закрыта в момент add/remove (`picker.hidden === true`) — перерисовка всё равно
  безопасна (просто обновляет скрытый DOM), но для чипов (7.2.3) можно опционально
  пропускать перерисовку при `picker.hidden`, аналогично 7.2.4 — не обязательно, DOM-апдейт
  скрытой панели не создаёт заметной цены на масштабе этих списков (≤ ~100 записей).
- Пустой список после фильтрации (все записи раздела уже добавлены) — уже покрыто
  существующим `|| '<div class="cdet-empty">Ничего не найдено.</div>'`, доп. текста
  («все уже добавлены») не требуется по объёму задачи, но это возможная косметика на
  усмотрение реализующего.
- «Другие фракции» — вне объёма (свободный текст, не привязан к библиотеке).

### 7.4 Тест-план

- Живая проверка (скилл `run-sanguine-web`): открыть страницу города → «Фракции» →
  добавить секту из пикера → убедиться, что она пропала из списка пикера и появилась в
  чипах → открыть тот же пикер повторно (закрыть/открыть) → убедиться, что список не
  включает добавленную → убрать чип крестиком → убедиться, что запись вернулась в список
  пикера (если панель ещё открыта). Повторить для «Независимых кланов», «Фракций смертных»,
  «Государственных фракций» (для последних двух — добавление/удаление через клик по строке
  в панели, не через чип).
- `npm test` — новых модульных тестов не требуется (чисто фронтенд-фильтрация без
  сохраняемого состояния), но прогнать полный набор для регресса.

---

## Часть 8 — Мульти-выбор титулов персонажа

### 8.1 Контекст и находка

Поле `hierarchy` («Титул»/«Иерархия»/«Титул в городе») сегодня — одиночное значение и на
фронте (`char-detail.js`), и в парсере (`web/lib/parsers/character.js:138`). Пикер
(`#cdet-title-picker`, `char-detail.js:1275-1310`, `1521-1580`) уже умеет приоритизировать
по секте/клану персонажа (`_renderTitlePickerLists`) — это часть остаётся без изменений,
меняется только модель выбора: один клик заменяет всё значение и закрывает панель → нужно
toggle-добавление через запятую с ✓-пометкой, без закрытия панели, **по образцу уже
реализованного пикера «Дисциплины»** (`_disciplineItemHtml`/`_disciplineAlreadyIn`/
`_cdetDisciplineTokens`, строки 1401–1450, 1594–1617).

**Критическая находка (см. анализ §2.2):** `web/routes/cities.js`,
`syncPoliticalCharacterHierarchy` (строки 268–306) при сохранении карты фракций города
**перезаписывает поле `hierarchy` целиком** при назначении персонажа на политическую роль
(Князь/Сенешаль/Примоген и т.п.), и **сравнивает поле целиком** при снятии роли. Без правки
этой функции многотитульность на фронте будет означать: назначение политроли — тихо стирает
любые вручную добавленные вторые титулы; снятие политроли — вообще перестаёт срабатывать,
если в поле есть что-то ещё кроме политического титула. Часть 8 включает обе стороны —
фронт и бэк — как один неделимый пункт (фронт без бэкенд-правки создаёт регресс).

### 8.2 Фронтенд — `web/public/scripts/char-detail.js`

**8.2.1 Токенизация значения поля** — переиспользовать уже существующий
`_cdetDisciplineTokens(value)` (строка 1404) без изменений: функция обобщённая (просто
`split(',').map(trim).filter(Boolean)`), несмотря на название — тот же паттерн переиспользования,
что уже применён в проекте к `_disciplineBareName` (см. её собственный коммент в коде:
«не специфичен дисциплинам по сути, несмотря на имя»). Переименовывать не нужно — не входит
в объём этой задачи.

**8.2.2 Сопоставление токена с записью библиотеки** — новый хелпер (у титулов имя в
библиотеке уже голое русское, без формата «Русское (English)» как у дисциплин/кланов —
сравнение проще, точное совпадение без хвостовой скобки):

```js
function _titleAlreadyIn(value, t) {
  const needle = t.name.trim().toLowerCase();
  return _cdetDisciplineTokens(value).some(tok => tok.trim().toLowerCase() === needle);
}
```

**8.2.3 `_titleItemHtml`** (строка 1528) — добавить параметр `selected`, зеркало
`_disciplineItemHtml` (строка 1418):

```js
function _titleItemHtml(t, selected) {
  const hint = escHtml(t.affiliation || '');
  const label = (t.negative ? '⚠️ ' : '') + t.name;
  return `<button type="button" class="v20-lib-item${selected ? ' cdet-lib-item-selected' : ''}" data-cdet-title="${escAttr(t.name)}"><span>${selected ? '✓ ' : ''}${escHtml(label)}</span><span class="v20-lib-hint">${hint}</span></button>`;
}
```

(CSS-класс `.cdet-lib-item-selected` уже существует — добавлен в Часть 1 для дисциплин,
новых стилей не требуется.)

**8.2.4 `_renderTitlePickerLists`** (строки 1533–1557) — передавать `selected` в
`_titleItemHtml`, читать текущее значение поля `hierarchy`:

```js
async function _renderTitlePickerLists(query) {
  await ensureTitles();
  const all = _titlesCache || [];
  const sectInput = document.querySelector('.cdet-field-input[data-field="sect"]');
  const clanInput = document.querySelector('.cdet-field-input[data-field="clan"]');
  const titleInput = document.querySelector('.cdet-field-input[data-field="hierarchy"]');
  const sect = sectInput?.value.trim() || '';
  const clan = clanInput?.value.trim() || '';
  const currentValue = titleInput?.value || '';
  const q = (query || '').toLowerCase();
  const matchesQuery = t => !q || t.name.toLowerCase().includes(q);
  const priority = all.filter(t => matchesQuery(t) && (_titleAffMatches(t.affiliation, sect) || _titleAffMatches(t.affiliation, clan)));
  const prioritySlugs = new Set(priority.map(t => t.slug));
  const rest = all.filter(t => matchesQuery(t) && !prioritySlugs.has(t.slug));

  const priorityGroup = document.querySelector('#cdet-title-picker .cdet-lib-picker-group[data-group="priority"]');
  const priorityList  = document.getElementById('cdet-title-list-priority');
  const allList       = document.getElementById('cdet-title-list-all');
  if (priorityGroup) priorityGroup.style.display = priority.length ? '' : 'none';
  if (priorityList) priorityList.innerHTML = priority.map(t => _titleItemHtml(t, _titleAlreadyIn(currentValue, t))).join('');
  if (allList) {
    allList.innerHTML = rest.length ? rest.map(t => _titleItemHtml(t, _titleAlreadyIn(currentValue, t))).join('')
      : (all.length
          ? '<div class="cdet-empty">Ничего не найдено — можно ввести название вручную.</div>'
          : '<div class="cdet-empty">Библиотека титулов пуста — можно ввести название вручную.</div>');
  }
}
```

**8.2.5 Клик-хендлер** (строки 1571–1581) — toggle add/remove вместо replace+close, зеркало
блока `discItem` (строки 1594–1617):

```js
const item = e.target.closest('#cdet-title-picker .v20-lib-item');
if (item) {
  const titleInput = document.querySelector('.cdet-field-input[data-field="hierarchy"]');
  const name = item.dataset.cdetTitle || '';
  if (titleInput && name) {
    const tokens = _cdetDisciplineTokens(titleInput.value);
    const idx = tokens.findIndex(tok => tok.trim().toLowerCase() === name.trim().toLowerCase());
    if (idx !== -1) tokens.splice(idx, 1); else tokens.push(name);
    titleInput.value = tokens.join(', ');
  }
  // Панель НЕ закрывается (можно добавить несколько подряд) — перерисовываем с текущим
  // поисковым запросом, чтобы ✓-пометки обновились (тот же паттерн, что у Дисциплин).
  await _renderTitlePickerLists(document.getElementById('cdet-title-search')?.value || '');
  return;
}
```

Убрать из этого блока: `titleInput.focus()` и `picker.hidden = true` (поведение закрытия
панели по выбору — старая модель, конфликтует с toggle-мультивыбором).

**8.2.6 Ручная правка поля держит ✓-пометки в синхроне** — новый `input`-делегат, зеркало
блока для `disciplines` (строки 1388–1399), но проще (у титулов нет производного datalist):

```js
document.addEventListener('input', e => {
  if (!e.target.matches('.cdet-field-input[data-field="hierarchy"]')) return;
  const titlePicker = document.getElementById('cdet-title-picker');
  if (titlePicker && !titlePicker.hidden) _renderTitlePickerLists(document.getElementById('cdet-title-search')?.value || '');
});
```

### 8.3 Бэкенд — `web/routes/cities.js`

**8.3.1 `syncPoliticalCharacterHierarchy`** (строки 268–306) — заменить полную
перезапись/сравнение поля на точечную работу с одним токеном внутри CSV-списка:

```js
async function syncPoliticalCharacterHierarchy(city, cityDisplay, records, prevRecords) {
  const warnings = [];
  const currByName = _rolesByName(records);
  const prevByName  = _rolesByName(prevRecords);
  if (!currByName.size && !prevByName.size) return warnings;

  let chars = [];
  try { chars = await getAllCharacters(city); }
  catch (e) { warnings.push(`Не удалось прочитать персонажей города для синка «Титула»: ${e.message}`); return warnings; }
  const charByName = new Map(chars.map(c => [c.name, c]));
  const hierarchyMdKey = EDITABLE_FIELD_MAP.hierarchy;

  // «Титул» — CSV-список (та же модель, что фронт применяет к «Дисциплинам»/«Титулу»,
  // см. char-detail.js:_cdetDisciplineTokens) — синк трогает ТОЛЬКО свой собственный
  // токен "${role} города ${cityDisplay}", остальные вручную добавленные титулы не задевает.
  const tokensOf = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

  // Выбывшие: держали роль ДО сохранения, сейчас ни на одной роли не числятся по имени.
  for (const [name, role] of prevByName) {
    if (currByName.has(name)) continue;
    const char = charByName.get(name);
    if (!char) continue; // персонаж переименован/удалён между сохранениями — нечего чистить
    const expected = `${role} города ${cityDisplay}`;
    const tokens = tokensOf(char.hierarchy);
    const idx = tokens.indexOf(expected);
    if (idx === -1) continue; // токена нет — снят вручную или не был проставлен, не трогаем
    tokens.splice(idx, 1);
    try { await writeCharacterCardField(city, char, hierarchyMdKey, tokens.join(', ')); }
    catch (e) { warnings.push(`Не удалось очистить «Титул» у «${name}»: ${e.message}`); }
  }
  // Новые/сохранившие роль: добавляем текущую должность, если её ещё нет среди токенов.
  for (const [name, role] of currByName) {
    const char = charByName.get(name);
    if (!char) continue; // ручной ввод текста, не выбор существующего персонажа — не пишем
    const value = `${role} города ${cityDisplay}`;
    const tokens = tokensOf(char.hierarchy);
    if (tokens.includes(value)) continue; // уже проставлено
    tokens.push(value);
    try { await writeCharacterCardField(city, char, hierarchyMdKey, tokens.join(', ')); }
    catch (e) { warnings.push(`Не удалось записать «Титул» «${name}» (${role}): ${e.message}`); }
  }
  return warnings;
}
```

Комментарий над функцией (строки 268–273) обновить — убрать формулировку «пишет ТОЛЬКО
когда…» как единственное условие; она остаётся верной, но нужно дописать про CSV/токены,
чтобы не вводить в заблуждение при следующем чтении кода.

### 8.4 Краевые случаи

- **Однотитульный персонаж (текущее поведение)** — токен-модель даёт идентичный результат:
  один элемент в списке токенов ведёт себя как раньше строка целиком (`tokens.join(', ')`
  пустого массива → `''`, ровно как раньше `''`). Существующий тест
  `web/tests/all.test.js` (`city-creation-restructure: …`, строки 6980–7012) должен
  продолжать проходить без изменений — это regression-гарантия правки.
- **Два персонажа на одну роль одновременно** — не может возникнуть: `_rolesByName` строит
  `Map` по имени, `currByName`/`prevByName` — по одному значению роли на имя, логика не
  меняется этой правкой.
- **Ручное дублирование токена** — если пользователь вручную вписал в «Титул» текст,
  случайно совпадающий с `"${role} города ${city}"` до того, как роль реально назначена —
  при назначении роли `tokens.includes(value)` уже вернёт true, повторно не добавит (нет
  дублей). Не баг, просто отмечается как обработанный краевой случай.
- **Персонаж с титулом, где сам текст роли содержит запятую** (гипотетически, названия
  политроли задаются администратором города, не библиотекой) — `tokensOf`/`join(', ')`
  такое сломает (запятая внутри одного логического токена разъедется на два токена). В
  реальных данных роли — фиксированный список («Князь», «Сенешаль», «Шериф» и т.п.) без
  запятых, риск теоретический; если он когда-то станет практическим — потребуется другой
  разделитель, вне объёма этой задачи.

### 8.5 Тест-план

- **Модульный тест** (обязательный, регресс-подтверждение находки §2.2 анализа) — добавить
  в `describe('city-creation-restructure: …')` (`web/tests/all.test.js`, рядом с
  существующим тестом строк 6980–7012) новый кейс:
  1. Создать персонажа, вручную выставить `hierarchy = 'Шериф'` через
     `PUT /api/characters/:slug/fields`.
  2. Назначить его на карте фракций города политроль (`political: 'Князь: <имя>'`) через
     `PUT /api/cities/:slug`.
  3. Проверить `hierarchy === 'Шериф, Князь города <город>'` (или обратный порядок —
     зафиксировать фактический порядок конкатенации токенов, `push` добавляет в конец).
  4. Снять роль (`political: ''` либо роль на другого персонажа) через повторный
     `PUT /api/cities/:slug`.
  5. Проверить `hierarchy === 'Шериф'` — политический токен убран, ручной остался.
- Живая проверка (скилл `run-sanguine-web`): открыть карточку персонажа-вампира → вкладка
  «Информация» → режим редактирования → добавить 2-3 титула подряд из пикера (панель не
  должна закрываться между кликами, ✓-пометки должны появляться) → сохранить → открыть
  повторно → все титулы на месте, через запятую. Отдельно проверить убирание одного из
  нескольких (клик по уже отмеченному ✓ элементу).
- Полный `npm test` после обеих правок (7 и 8), `git checkout -- web/tests/report.html`
  после прогона.

---

## Порядок реализации

1. **Часть 7** (дедуп пикеров фракций) — независима от Части 8, без рисков для сохраняемых
   данных, можно сделать и слить первой.
2. **Часть 8** — фронт (8.2) и бэкенд (8.3) реализовывать вместе, в одном PR/коммите:
   раздельная поставка (например, только фронт) оставляет продакшн в состоянии с активным
   багом тихой потери титулов при синке с картой фракций города (см. находку §2.2 анализа).
   Модульный тест (8.5, п.1) писать до или сразу после 8.3 — он и есть приёмочный критерий
   находки.
3. Часть 3 запроса (клановый фильтр дисциплин) — без работы, отметить в финальном отчёте
   как уже покрытое.
