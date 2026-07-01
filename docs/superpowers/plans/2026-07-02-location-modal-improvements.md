# Location Modal Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить сохранение названия локации, расширить генерацию карточки (Сенсорная палитра + Контекст), добавить вкладку «Сенсорика» в детальное окно и включить редактирование «Ключевых точек».

**Architecture:** Все изменения в рамках существующего стека (Express/Node + Vanilla JS SPA). Сервер: добавляем `subtype` dedicated branch и новые ключи (`sensoryPalette`, `keyPoints`) в `PUT /api/locations/:slug/fields`. Парсер: добавляем `sensoryPalette` в `parseLocation`. Фронтенд: два новых textarea в edit-modal, новая вкладка «Сенсорика» и активация редактирования «Ключевые точки» в detail modal.

**Tech Stack:** Node.js 22, Express, Vanilla JS, Markdown file storage (`cities/<city>/locations/<district>/<slug>/<slug>.md`)

---

## Файлы, которые меняются

| Файл | Что меняется |
|---|---|
| `web/server.js` | PUT /fields: добавить dedicated `subtype` ветку (H1 + metadata), `sensoryPalette` ветку, `keyPoints` ветку. `_locCardTemplate`: добавить `## 🗺️ Ключевые точки` |
| `web/lib/parsers.js` | `parseLocation`: добавить парсинг `sensoryPalette` |
| `web/public/scripts.js` | `openLocDetail`: `sensViewHtml`/`sensEditHtml` + новая вкладка `sens` + `keyEditHtml` + убрать `noEdit:true` для keys. `_locSavePanel`: ветки `sens` и `keys`. `openLocEditModal`/`saveLocEdit`/`runLocFullGen`: поля `sensoryPalette` и `vtmText` |
| `web/public/index.html` | Два новых textarea в `loc-edit-modal`: `loc-edit-sensory` и `loc-edit-vtm-context` |

---

## Контекст кода (важно знать)

- **`PUT /api/locations/:slug/fields`** (`server.js:2813-2877`): итерирует `req.body.fields`, диспатчит по ключу через `if` ветки. Инлайновый `fieldMap` (строка 2862) обрабатывает поля метаданных через regex `**Ключ:** value`. Сейчас `subtype` попадает в `fieldMap` и обновляет только строку `> **Название:** …`, не трогая H1.
- **`_locCardTemplate`** (`server.js:2922-2953`): шаблон карточки. Уже содержит `## 👁️ Сенсорная палитра` (таблица) и `## 🩸 Контекст Камарильи / Масок` (таблица). Не содержит `## 🗺️ Ключевые точки`.
- **`parseLocation`** (`parsers.js:522-607`): читает H1 в `loc.title`, метаданные через `metaField()`, атмосферу, VtM-таблицу, `keyPoints` из таблицы (уже есть, строка 587). `sensoryPalette` не парсится совсем.
- **`openLocDetail`** (`scripts.js:8441-8602`): строит HTML inline. Вкладки жёстко прописаны в строках 8569-8576. Вкладка `keys` (строка 8581) с `{ noEdit: true }` — кнопки редактирования нет.
- **`_locSavePanel`** (`scripts.js:8706-8750`): диспатч по имени панели, формирует `fields`, вызывает `PUT /fields`.
- **`runLocFullGen`** (`scripts.js:9556-9595`): парсит AI-ответ тремя regex — только Атмосфера, Крючки, промт.
- **`runLocFieldRegen`** (`scripts.js:9530-9549`): `fieldMap` на строке 9545: `{ atmosphere, imagePrompt, hooks }`. Нужно добавить `vtmText`.
- **`openLocEditModal`** (`scripts.js:9361-9403`): очищает/заполняет поля формы из `STATE.locations`.
- **`saveLocEdit`** (`scripts.js:9430-9502`): edit-ветка (строки 9441-9459) и create-ветка (строки 9460-9498). `zone` уже добавлена в обе.

---

### Task 1: Исправить сохранение названия — H1 не обновляется

**Проблема:** `subtype` попадает в `fieldMap` (server.js:2862) и меняет только `> **Название:** Old` → `> **Название:** New`. H1 (`# Old Name`) не трогается. После сохранения `loc.title` (из H1) и `loc.subtype` расходятся.

**Files:**
- Modify: `web/server.js:2852-2870`

- [ ] **Шаг 1.1: Добавить dedicated `subtype` ветку перед `fieldMap`**

В `web/server.js`, после строки 2860 (конец `hooks` ветки, `continue;`), перед строкой 2861 (`// Inline metadata fields`), вставить:

```js
      if (key === 'subtype') {
        // Update H1
        card = card.replace(/^(#\s+).+$/m, `$1${value}`);
        // Update inline metadata field **Название:**
        card = card.replace(
          /(\*\*Название:\*\*)\s*([^|\n]+?)(?=\s*\||\s*\n|$)/m,
          `$1 ${value}`
        );
        continue;
      }
```

- [ ] **Шаг 1.2: Убрать `subtype` из `fieldMap`**

Строка 2862 — удалить `subtype: 'Название',` из объекта:

```js
      const fieldMap = { district: 'Округ', neighborhood: 'Район', address: 'Адрес', control: 'Контроль', zone: 'Зона' };
```

- [ ] **Шаг 1.3: Проверить через curl**

```bash
# Найти тестовую локацию
curl -s "http://localhost:3000/api/locations?city=balmont" | node -e "const d=require('fs').readFileSync(0,'utf8');const locs=JSON.parse(d);console.log(locs[0]?.slug)"

# Сохранить новое название (подставь реальный slug)
curl -s -X PUT "http://localhost:3000/api/locations/metro/fields?city=balmont" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"subtype":"Тестовое название"}}'

# Проверить что H1 и метаданные обновились
head -5 "cities/balmont/locations/Ценр/metro/metro.md"
```

Ожидание: первая строка файла `# Тестовое название`, вторая строка содержит `**Название:** Тестовое название`.

- [ ] **Шаг 1.4: Откатить тест**

```bash
curl -s -X PUT "http://localhost:3000/api/locations/metro/fields?city=balmont" \
  -H "Content-Type: application/json" \
  -d '{"fields":{"subtype":"Метро"}}'
```

- [ ] **Шаг 1.5: Коммит**

```bash
git add web/server.js
git commit -m "fix: сохранение названия локации обновляет H1 и метаданные"
```

---

### Task 2: Добавить `## 🗺️ Ключевые точки` в шаблон + PUT handler

**Проблема:** `_locCardTemplate` не содержит секцию «Ключевые точки», поэтому AI не заполняет её при генерации. `PUT /fields` не имеет ветки для `keyPoints`.

**Files:**
- Modify: `web/server.js:2944` (шаблон)
- Modify: `web/server.js:2852-2860` (PUT handler)

- [ ] **Шаг 2.1: Добавить секцию в `_locCardTemplate`**

В `web/server.js`, строка 2944 — перед `## 🪝 Сценарные крючки` вставить:

```js
function _locCardTemplate(name, district) {
  return `# ${name}
> **Название:** ${name} | **Округ:** ${district || '[округ]'} | **Район:** [район] | **Адрес:** [адрес] | **Зона:** [🟢/🟡/🔴] | **Контроль:** [фракция]
---
## 🎭 Атмосфера
[2–3 предложения]
## 👁️ Сенсорная палитра
| Канал | |
|---|---|
| **Свет** | |
| **Звук** | |
| **Запах** | |
| **Тактильное** | |
---
## 🩸 Контекст Камарильи / Масок
| | |
|---|---|
| **Статус** | |
| **Фракция** | |
| **Постоянные фигуры** | |
| **Угрозы** | |
| **Маскарад** | 🔴/🟡/🟢 |
---
## 🗺️ Ключевые точки
| Место | Описание |
|---|---|
| | |
---
## 🪝 Сценарные крючки
1. [крючок]
## 🖼️ Изображения
- ⏳ Изображение не предоставлено
## 🎨 Промт для генерации изображения
\`\`\`
[промт]
\`\`\`
`;
}
```

- [ ] **Шаг 2.2: Добавить `keyPoints` ветку в PUT handler**

В `web/server.js`, после строки 2860 (конец `hooks` ветки), после нового `subtype` блока из Task 1, добавить:

```js
      if (key === 'keyPoints') {
        card = card.replace(
          /(## (?:🗺️\s+)?Ключевые точки[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i,
          (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`
        );
        continue;
      }
```

- [ ] **Шаг 2.3: Коммит**

```bash
git add web/server.js
git commit -m "feat: добавить Ключевые точки в шаблон карточки + PUT handler"
```

---

### Task 3: Добавить `sensoryPalette` в PUT handler + парсер

**Files:**
- Modify: `web/server.js:2852-2860`
- Modify: `web/lib/parsers.js:543-545`

- [ ] **Шаг 3.1: Добавить `sensoryPalette` ветку в PUT handler**

В `web/server.js`, после `keyPoints` ветки из Task 2:

```js
      if (key === 'sensoryPalette') {
        card = card.replace(
          /(## (?:👁️\s+)?Сенсорная палитра[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i,
          (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`
        );
        continue;
      }
```

- [ ] **Шаг 3.2: Добавить парсинг `sensoryPalette` в `parseLocation`**

В `web/lib/parsers.js`, после строки 545 (конец парсинга `atmosphere`):

```js
  // Sensory palette — raw table text
  const sensM = content.match(/## (?:👁️\s+)?Сенсорная палитра[^\n]*\n+([\s\S]+?)(?=\n## |\n---)/i);
  if (sensM) {
    loc.sensoryPalette = (sensM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || [])
      .filter(r => !r.match(/[-]{3}/))
      .map(r => {
        const cells = r.split('|').slice(1, -1).map(c => c.replace(/\*\*/g, '').trim());
        return { channel: cells[0], value: cells[1] };
      })
      .filter(r => r.channel && r.value);
  } else {
    loc.sensoryPalette = [];
  }
```

- [ ] **Шаг 3.3: Проверить парсер curl-тестом**

```bash
curl -s "http://localhost:3000/api/locations?city=paris" | node -e "
const d=require('fs').readFileSync(0,'utf8');
const locs=JSON.parse(d);
const l=locs.find(l=>l.sensoryPalette?.length>0);
console.log(l ? JSON.stringify(l.sensoryPalette,null,2) : 'нет данных — OK для пустых карточек');"
```

- [ ] **Шаг 3.4: Коммит**

```bash
git add web/server.js web/lib/parsers.js
git commit -m "feat: sensoryPalette — PUT handler + парсер"
```

---

### Task 4: Два новых поля в edit-modal (Сенсорика и Контекст VtM)

Добавляем `loc-edit-sensory` и `loc-edit-vtm-context` — textarea в форме создания/редактирования. Это позволит сохранять эти секции через `saveLocEdit` и заполнять их при `runLocFullGen`.

**Files:**
- Modify: `web/public/index.html:1042-1058`
- Modify: `web/public/scripts.js:9375-9398` (clear/populate)
- Modify: `web/public/scripts.js:9441-9498` (saveLocEdit fields + extraFields)
- Modify: `web/public/scripts.js:9545` (runLocFieldRegen fieldMap)
- Modify: `web/public/scripts.js:9578-9586` (runLocFullGen parsing)

- [ ] **Шаг 4.1: Добавить два textarea в `index.html`**

В `web/public/index.html`, после блока `loc-edit-atmosphere` (строка 1040, после `</div>`), вставить:

```html
      <div class="chr-form-group loc-edit-field-with-gen">
        <div class="loc-edit-field-header">
          <label class="chr-form-label" for="loc-edit-sensory">Сенсорная палитра</label>
        </div>
        <textarea class="chr-form-textarea" id="loc-edit-sensory" rows="5" placeholder="| **Свет** | ... |&#10;| **Звук** | ... |"></textarea>
      </div>

      <div class="chr-form-group loc-edit-field-with-gen">
        <div class="loc-edit-field-header">
          <label class="chr-form-label" for="loc-edit-vtm-context">Контекст Камарильи / Масок</label>
          <button class="loc-edit-regen-btn" data-field="vtmText" title="Перегенерировать">🔄</button>
        </div>
        <textarea class="chr-form-textarea" id="loc-edit-vtm-context" rows="3" placeholder="Описание контекста Камарильи…"></textarea>
      </div>
```

- [ ] **Шаг 4.2: Добавить очистку в `openLocEditModal`**

В `scripts.js`, строка 9375 — расширить массив в `.forEach`:

```js
  ['name','district','neighborhood','address','control','atmosphere','hooks','image-prompt','context','sensory','vtm-context'].forEach(id => {
    const el = document.getElementById(`loc-edit-${id}`);
    if (el) el.value = '';
  });
```

- [ ] **Шаг 4.3: Добавить заполнение в `openLocEditModal`**

В `scripts.js`, после строки 9391 (`loc-edit-image-prompt`), добавить:

```js
      document.getElementById('loc-edit-sensory').value =
        (loc.sensoryPalette || []).map(s => `| **${s.channel}** | ${s.value} |`).join('\n');
      document.getElementById('loc-edit-vtm-context').value = loc.vtmText || '';
```

- [ ] **Шаг 4.4: Добавить поля в edit-ветку `saveLocEdit`**

В `scripts.js`, строка 9452 — в объект `fields` добавить:

```js
        sensoryPalette: document.getElementById('loc-edit-sensory').value.trim(),
        vtmText:        document.getElementById('loc-edit-vtm-context').value.trim(),
```

- [ ] **Шаг 4.5: Добавить поля в create-ветку `saveLocEdit` (extraFields)**

В `scripts.js`, в объект `extraFields` (около строки 9478) добавить:

```js
        sensoryPalette: document.getElementById('loc-edit-sensory').value.trim(),
        vtmText:        document.getElementById('loc-edit-vtm-context').value.trim(),
```

- [ ] **Шаг 4.6: Расширить `runLocFieldRegen` fieldMap**

В `scripts.js`, строка 9545:

```js
    const fieldMap = { atmosphere: 'atmosphere', imagePrompt: 'image-prompt', hooks: 'hooks', vtmText: 'vtm-context' };
```

- [ ] **Шаг 4.7: Расширить `runLocFullGen` — парсинг двух новых секций**

В `scripts.js`, после строки 9586 (после `promptM`), добавить:

```js
    const sensM = content.match(/##\s*👁️\s*Сенсорная палитра\s*\n+([\s\S]+?)(?=\n##|\n---|$)/i);
    if (sensM) {
      const tableRows = (sensM[1].match(/^\|[^|\n]+\|[^|\n]+\|/gm) || []).filter(r => !r.match(/[-]{3}/));
      document.getElementById('loc-edit-sensory').value = tableRows.join('\n');
    }

    const vtmM = content.match(/##\s*🩸\s*Контекст[^\n]*\n+([\s\S]+?)(?=\n##|\n---|$)/i);
    if (vtmM) {
      const prose = vtmM[1].split('\n').filter(l => !l.startsWith('|') && l.trim()).join('\n').trim();
      if (prose) document.getElementById('loc-edit-vtm-context').value = prose;
    }
```

- [ ] **Шаг 4.8: Коммит**

```bash
git add web/public/index.html web/public/scripts.js
git commit -m "feat: поля Сенсорная палитра и Контекст VtM в edit-modal + генерация"
```

---

### Task 5: Вкладка «Сенсорика» в detail modal

**Files:**
- Modify: `web/public/scripts.js:8502-8509` (добавить sensViewHtml/sensEditHtml)
- Modify: `web/public/scripts.js:8569-8583` (новая вкладка + панель)
- Modify: `web/public/scripts.js:8706-8727` (_locSavePanel)

- [ ] **Шаг 5.1: Добавить builders для Сенсорики**

В `scripts.js`, после строки 8508 (конец `keyPointsHtml`), добавить:

```js
  const sensViewHtml = loc.sensoryPalette?.length
    ? `<div class="locdet-table">${loc.sensoryPalette.map(s =>
        `<div class="locdet-row">
          <div class="locdet-key">${escHtml(s.channel)}</div>
          <div class="locdet-val">${escHtml(s.value)}</div>
        </div>`).join('')}</div>`
    : '<div class="cdet-empty">Сенсорная палитра не заполнена</div>';
  const sensRawTable = (loc.sensoryPalette || []).map(s => `| **${s.channel}** | ${s.value} |`).join('\n')
    || '| **Свет** | |\n| **Звук** | |\n| **Запах** | |\n| **Тактильное** | |';
  const sensEditHtml = `<textarea class="cdet-edit-textarea" id="locdet-sens-ta" rows="8">${escHtml(sensRawTable)}</textarea>`;
```

- [ ] **Шаг 5.2: Добавить вкладку в tab-bar**

В `scripts.js`, строка 8572 — вставить кнопку вкладки между `vtm` и `keys`:

```js
      <div class="cdet-tab-bar">
        <button class="cdet-tab active" data-tab="meta">Метаданные</button>
        <button class="cdet-tab" data-tab="atm">Атмосфера</button>
        <button class="cdet-tab" data-tab="vtm">VtM</button>
        <button class="cdet-tab" data-tab="sens">Сенсорика</button>
        <button class="cdet-tab" data-tab="keys">Ключевые точки</button>
        <button class="cdet-tab" data-tab="hooks">Крючки</button>
        <button class="cdet-tab" data-tab="images">🖼 Изображения</button>
      </div>
```

- [ ] **Шаг 5.3: Добавить панель Сенсорики + активировать редактирование Ключевых точек**

В `scripts.js`, строки 8577-8583 — заменить на:

```js
      <div class="cdet-panels">
        <div class="cdet-panel active" data-panel="meta">${editPanel('meta', metaViewHtml, metaEditHtml)}</div>
        <div class="cdet-panel" data-panel="atm">${editPanel('atm', atmViewHtml, atmEditHtml)}</div>
        <div class="cdet-panel" data-panel="vtm">${editPanel('vtm', vtmViewHtml, vtmEditHtml)}</div>
        <div class="cdet-panel" data-panel="sens">${editPanel('sens', sensViewHtml, sensEditHtml)}</div>
        <div class="cdet-panel" data-panel="keys">${editPanel('keys', keyPointsHtml, keyEditHtml)}</div>
        <div class="cdet-panel" data-panel="hooks">${editPanel('hooks', hooksViewHtml, hooksEditHtml)}</div>
```

- [ ] **Шаг 5.4: Добавить ветку `sens` в `_locSavePanel`**

В `scripts.js`, после строки 8715 (конец ветки `vtm`), добавить:

```js
  } else if (panel === 'sens') {
    fields.sensoryPalette = document.getElementById('locdet-sens-ta')?.value || '';
```

- [ ] **Шаг 5.5: Перезапустить сервер и проверить**

```bash
curl -s -X POST http://localhost:3000/api/restart
```

Открыть любую локацию в браузере → проверить что вкладка «Сенсорика» появилась, таблица отображается (или заглушка для пустых карточек). Нажать «Редактировать», изменить строку, сохранить.

- [ ] **Шаг 5.6: Коммит**

```bash
git add web/public/scripts.js
git commit -m "feat: вкладка Сенсорика в детальном окне локации"
```

---

### Task 6: Включить редактирование «Ключевые точки» в detail modal

**Files:**
- Modify: `web/public/scripts.js:8502-8509` (добавить `keyEditHtml`)
- Modify: `web/public/scripts.js:8581` (убрать `noEdit:true`)
- Modify: `web/public/scripts.js:8706-8727` (`_locSavePanel`)

*Примечание: шаг 5.3 уже убрал `{ noEdit: true }` из `keys` и передаёт `keyEditHtml`. Но `keyEditHtml` нужно объявить — сделаем в этом таске.*

- [ ] **Шаг 6.1: Объявить `keyEditHtml` — добавить после `keyPointsHtml`**

В `scripts.js`, после строки 8508 (конец `keyPointsHtml`), перед строкой с `sensViewHtml` из Task 5:

```js
  const keyRawTable = (loc.keyPoints || []).map(kp => `| ${kp.place} | ${kp.desc} |`).join('\n')
    || '| | |';
  const keyEditHtml = `<textarea class="cdet-edit-textarea" id="locdet-keys-ta" rows="10">${escHtml(keyRawTable)}</textarea>`;
```

- [ ] **Шаг 6.2: Добавить ветку `keys` в `_locSavePanel`**

В `scripts.js`, после ветки `sens` из Task 5.4:

```js
  } else if (panel === 'keys') {
    fields.keyPoints = document.getElementById('locdet-keys-ta')?.value || '';
```

- [ ] **Шаг 6.3: Проверить сохранение ключевых точек**

```bash
curl -s -X POST http://localhost:3000/api/restart
```

Открыть локацию → вкладка «Ключевые точки» → «Редактировать» → вписать `| Вход | Охраняется |` → Сохранить.

```bash
grep -A3 "Ключевые точки" "f:/VTM/VTM-project-Claude/cities/balmont/locations/Ценр/metro/metro.md"
```

Ожидание: строка `| Вход | Охраняется |` в файле.

- [ ] **Шаг 6.4: Коммит**

```bash
git add web/public/scripts.js
git commit -m "feat: редактирование Ключевых точек в детальном окне локации"
```

---

## Итоговая проверка

После всех тасков проверить три сценария:

| Сценарий | Ожидание |
|---|---|
| Редактировать название → Сохранить | H1 и `**Название:**` в файле — оба обновились |
| Создать локацию → заполнить все поля → Сохранить | Все поля (включая Сенсорную палитру и Контекст) записаны в `.md` |
| «Сгенерировать карточку» | Все 5 полей заполнены: Атмосфера, Крючки, Промт, Сенсорика, Контекст VtM |
| Detail modal → вкладка «Сенсорика» | Таблица видна, редактирование работает, сохранение работает |
| Detail modal → вкладка «Ключевые точки» | Кнопка «Редактировать» активна, сохранение пишет в файл |

---

## Self-Review

**Spec coverage:**
- ✅ Название не обновляет H1 → Task 1
- ✅ Данные из модального окна создания не попадают в карточку → Task 4 (sensoryPalette, vtmText добавлены в extraFields) + Tasks 1-3 (PUT handler)
- ✅ Генерация только Атмосферы → Task 4.7 (runLocFullGen расширен)
- ✅ Вкладки для Сенсорной палитры и Контекста Камарильи → Task 5 (Сенсорика), Контекст уже есть в VtM-вкладке
- ✅ Редактирование Ключевых точек → Tasks 2 + 6

**Placeholder scan:** нет TBD/TODO, весь код приведён.

**Type consistency:**
- `sensoryPalette` везде: PUT key = `sensoryPalette`, `loc.sensoryPalette = [{channel, value}]`, textarea id = `locdet-sens-ta` / `loc-edit-sensory`
- `keyPoints` везде: PUT key = `keyPoints`, `loc.keyPoints = [{place, desc}]`, textarea id = `locdet-keys-ta`
- `vtmText` везде: PUT key = `vtmText` (уже есть), textarea id = `locdet-vtm-ta` (detail) / `loc-edit-vtm-context` (edit modal)
