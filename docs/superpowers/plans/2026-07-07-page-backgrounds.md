# Тематические фоновые иллюстрации разделов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать каждому из 13 верхнеуровневых разделов веб-интерфейса свою атмосферную фоновую иллюстрацию вместо одинакового плоского фона.

**Architecture:** Один AI-сгенерированный PNG на раздел в `web/public/img/backgrounds/<page>.png`. Каждая секция `#page-<name>` получает CSS-переменную `--page-bg-image: url(...)`. Общее правило `.page` расширяет уже существующий multi-layer `background` (см. `web/public/styles.css:284-297`) дополнительным слоем изображения и слоем затемнения строго над ним — без новых `::before/::after` или `position: fixed`, по аналогии с текущим паттерном (акцентный radial-gradient уже рисуется прямо на `.page`). Рисуется только активный раздел, т.к. `.page:not(.active)` имеет `display: none`.

**Tech Stack:** Чистый CSS (без сборки), изображения генерируются через `canvas-design` skill.

**Отклонение от спеки** ([`docs/superpowers/specs/2026-07-07-page-backgrounds-design.md`](../specs/2026-07-07-page-backgrounds-design.md)): формат файлов — `.png`, а не `.webp` (в окружении нет `cwebp`/ImageMagick для конвертации, только системный `convert.exe` Windows, который не про изображения). Механизм подключения — доп. слои в существующем `background` на `.page`, а не отдельные fixed-пseudo-элементы — эквивалентный результат, ближе к текущему коду. Целевой вес файла остаётся ориентиром (≤ 250 КБ на PNG), т.к. PNG тяжелее webp при той же детализации.

---

## Файловая структура

- **Create:** `web/public/img/backgrounds/dashboard.png`, `chronicle.png`, `characters.png`, `graph.png`, `factions.png`, `chronicles-page.png`, `modules.png`, `threads.png`, `rumors.png`, `locations.png`, `library.png`, `tools.png`, `search.png` — по одному на раздел.
- **Modify:** `web/public/styles.css` — блок `.page` (строки 284-297) и новый блок CSS-переменных `--page-bg-image` под каждым `#page-<name>`.

---

### Task 1: CSS-механизм подключения фона (на одном разделе, для проверки пайплайна)

**Files:**
- Modify: `web/public/styles.css:284-297`
- Create: `web/public/img/backgrounds/dashboard.png`

- [ ] **Step 1: Сгенерировать тестовую иллюстрацию для дашборда через `canvas-design` skill**

  Вызвать skill `canvas-design` с промтом в духе:
  "Atmospheric dark gothic illustration for a Vampire: the Masquerade Paris 2010 chronicle
  manager dashboard page. Moody noir Paris skyline at night, muted crimson and near-black
  palette (#07050a background tone), subtle candlelight glow, no text, no UI elements,
  painterly digital art, 1600x1000, wide landscape composition with darker edges and
  lighter center-left area suitable for overlaying UI text."

  Сохранить результат как `web/public/img/backgrounds/dashboard.png`. Убедиться, что размер
  файла разумный (открыть свойства файла) — если явно больше ~1-2 МБ, переэкспортировать
  с меньшим разрешением/качеством через тот же skill.

- [ ] **Step 2: Добавить CSS-переменную для дашборда**

  В `web/public/styles.css` сразу после блока `.page.active { display: block; }` (строка 301)
  добавить:

  ```css
  #page-dashboard {
    --page-bg-image: url('img/backgrounds/dashboard.png');
  }
  ```

- [ ] **Step 3: Расширить фон `.page` слоем изображения и затемнением**

  Заменить текущий блок (`web/public/styles.css:284-297`):

  ```css
  .page {
    display: none;
    height: 100vh;
    overflow-y: auto;
    padding: 36px 40px;
    background: radial-gradient(ellipse 900px 560px at -4% -8%, rgba(139, 0, 0, .22), transparent 62%),
                linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  }
  ```

  на:

  ```css
  .page {
    display: none;
    height: 100vh;
    overflow-y: auto;
    padding: 36px 40px;
    --page-bg-image: none;
    background:
      radial-gradient(ellipse 900px 560px at -4% -8%, rgba(139, 0, 0, .22), transparent 62%),
      linear-gradient(180deg, rgba(7, 5, 10, .82), rgba(7, 5, 10, .93)),
      var(--page-bg-image) center / cover no-repeat,
      linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  }
  ```

  `--page-bg-image: none;` в базовом `.page` — фолбэк для разделов, которым ещё не
  назначена картинка (в конце плана он назначен всем 13, но так порядок задачи не важен
  и промежуточные страницы не ломаются).

- [ ] **Step 4: Проверить в браузере**

  Использовать skill `run-sanguine-web`: перезапустить dev-сервер, открыть раздел
  «Панель» (dashboard). Ожидается: под контентом виден затемнённый готический фон,
  текст читается так же хорошо, как раньше (нет провала контраста), при скролле
  внутри раздела фон не «прыгает» и не создаёт мерцания.

- [ ] **Step 5: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/dashboard.png
  git commit -m "feat: add themed background illustration mechanism (dashboard)"
  ```

---

### Task 2: Иллюстрация для раздела «Хронология» (`chronicle`)

**Files:**
- Modify: `web/public/styles.css` (добавить блок `#page-chronicle`)
- Create: `web/public/img/backgrounds/chronicle.png`

- [ ] **Step 1: Сгенерировать иллюстрацию через `canvas-design`**

  Промт: "Atmospheric dark gothic illustration representing a timeline of vampire
  chronicle events in Paris 2010 — an ornate antique clock or hourglass motif dissolving
  into fog, muted crimson and near-black palette, no text, no UI elements, painterly
  digital art, 1600x1000, wide landscape, darker edges."

  Сохранить как `web/public/img/backgrounds/chronicle.png`.

- [ ] **Step 2: Добавить CSS-переменную**

  Добавить после блока `#page-dashboard` в `web/public/styles.css`:

  ```css
  #page-chronicle {
    --page-bg-image: url('img/backgrounds/chronicle.png');
  }
  ```

- [ ] **Step 3: Проверить в браузере** (skill `run-sanguine-web`, раздел «Хронология»).

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/chronicle.png
  git commit -m "feat: add background illustration for chronicle page"
  ```

---

### Task 3: Иллюстрация для раздела «Персонажи» (`characters`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/characters.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing vampire
  characters — an ornate empty portrait frame or veiled silhouette in candlelight,
  muted crimson and near-black palette, no text, no faces in detail, no UI elements,
  painterly digital art, 1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/characters.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-characters {
    --page-bg-image: url('img/backgrounds/characters.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Персонажи».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/characters.png
  git commit -m "feat: add background illustration for characters page"
  ```

---

### Task 4: Иллюстрация для раздела «Связи» (`graph`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/graph.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration of an intricate web of
  crimson threads or a spider web connecting faint nodes, symbolizing a network of
  relationships, muted crimson and near-black palette, no text, no UI elements,
  painterly digital art, 1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/graph.png`.

  Примечание: `#page-graph` уже имеет отдельные правила `padding: 0; overflow: hidden;`
  (`web/public/styles.css:303-311`) для canvas-based графа связей — фон всё равно
  применится, т.к. эти правила не переопределяют `background`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-graph {
    --page-bg-image: url('img/backgrounds/graph.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Связи» — убедиться, что сам граф
  (canvas/svg поверх) по-прежнему читается на фоне.

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/graph.png
  git commit -m "feat: add background illustration for graph page"
  ```

---

### Task 5: Иллюстрация для раздела «Фракции» (`factions`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/factions.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing vampire
  political factions — heraldic banners or clan sigils half-hidden in shadow and fog,
  muted crimson and near-black palette, no text, no UI elements, painterly digital art,
  1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/factions.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-factions {
    --page-bg-image: url('img/backgrounds/factions.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Фракции».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/factions.png
  git commit -m "feat: add background illustration for factions page"
  ```

---

### Task 6: Иллюстрация для раздела «Хроники» (`chronicles-page`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/chronicles-page.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing a collection
  of story chronicles — a stack of old leather-bound journals with a wax seal, dim
  candlelight, muted crimson and near-black palette, no text, no UI elements, painterly
  digital art, 1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/chronicles-page.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-chronicles-page {
    --page-bg-image: url('img/backgrounds/chronicles-page.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Хроники».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/chronicles-page.png
  git commit -m "feat: add background illustration for chronicles list page"
  ```

---

### Task 7: Иллюстрация для раздела «Модули» (`modules`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/modules.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing modular story
  sessions — scattered tarot-like cards or puzzle fragments arranged on a dark table,
  muted crimson and near-black palette, no text, no UI elements, painterly digital art,
  1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/modules.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-modules {
    --page-bg-image: url('img/backgrounds/modules.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Модули».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/modules.png
  git commit -m "feat: add background illustration for modules page"
  ```

---

### Task 8: Иллюстрация для раздела «Нити» (`threads`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/threads.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing unresolved
  plot threads — tangled crimson thread or string unspooling into darkness, muted
  crimson and near-black palette, no text, no UI elements, painterly digital art,
  1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/threads.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-threads {
    --page-bg-image: url('img/backgrounds/threads.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Нити».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/threads.png
  git commit -m "feat: add background illustration for threads page"
  ```

---

### Task 9: Иллюстрация для раздела «Слухи» (`rumors`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/rumors.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing whispered
  rumors — faint overlapping silhouettes whispering in a foggy Paris alley at night,
  muted crimson and near-black palette, no text, no UI elements, painterly digital art,
  1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/rumors.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-rumors {
    --page-bg-image: url('img/backgrounds/rumors.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Слухи».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/rumors.png
  git commit -m "feat: add background illustration for rumors page"
  ```

---

### Task 10: Иллюстрация для раздела «Локации» (`locations`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/locations.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration of a moody Paris street
  or park path at night, wrought-iron lamppost, wet cobblestones, muted crimson and
  near-black palette, no text, no UI elements, painterly digital art, 1600x1000, wide
  landscape, darker edges." Сохранить как `web/public/img/backgrounds/locations.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-locations {
    --page-bg-image: url('img/backgrounds/locations.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Локации».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/locations.png
  git commit -m "feat: add background illustration for locations page"
  ```

---

### Task 11: Иллюстрация для раздела «Библиотека» (`library`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/library.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration of an ancient occult
  library — tall bookshelves disappearing into shadow, an open grimoire on a desk,
  candlelight, muted crimson and near-black palette, no text, no UI elements, painterly
  digital art, 1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/library.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-library {
    --page-bg-image: url('img/backgrounds/library.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Библиотека».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/library.png
  git commit -m "feat: add background illustration for library page"
  ```

---

### Task 12: Иллюстрация для раздела «Инструменты» (`tools`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/tools.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing craftsman's
  tools of a storyteller — an antique quill, ink well, wax seal and blank parchment on
  a dark desk, muted crimson and near-black palette, no text, no UI elements, painterly
  digital art, 1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/tools.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-tools {
    --page-bg-image: url('img/backgrounds/tools.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Инструменты».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/tools.png
  git commit -m "feat: add background illustration for tools page"
  ```

---

### Task 13: Иллюстрация для раздела «Поиск» (`search`)

**Files:**
- Modify: `web/public/styles.css`
- Create: `web/public/img/backgrounds/search.png`

- [ ] **Step 1:** Промт: "Atmospheric dark gothic illustration symbolizing a search
  through darkness — a single lantern or magnifying glass casting light into deep fog,
  muted crimson and near-black palette, no text, no UI elements, painterly digital art,
  1600x1000, wide landscape, darker edges." Сохранить как
  `web/public/img/backgrounds/search.png`.

- [ ] **Step 2:** Добавить:

  ```css
  #page-search {
    --page-bg-image: url('img/backgrounds/search.png');
  }
  ```

- [ ] **Step 3:** Проверить в браузере, раздел «Поиск».

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/styles.css web/public/img/backgrounds/search.png
  git commit -m "feat: add background illustration for search page"
  ```

---

### Task 14: Финальная сквозная проверка и preload дашборда

**Files:**
- Modify: `web/public/index.html` (добавить `<link rel="preload">` в `<head>`)

- [ ] **Step 1: Добавить preload для фона дашборда**

  В `web/public/index.html`, внутри `<head>`, рядом с другими `<link>`, добавить:

  ```html
  <link rel="preload" as="image" href="img/backgrounds/dashboard.png">
  ```

- [ ] **Step 2: Пройти все 13 разделов в браузере**

  Через skill `run-sanguine-web`: перезапустить dev-сервер, последовательно открыть
  каждый пункт `nav-item` (Панель, Хронология, Персонажи, Связи, Фракции, Хроники,
  Модули, Нити, Слухи, Локации, Библиотека, Инструменты, Поиск). Для каждого убедиться:
  - фон виден и тематически соответствует разделу;
  - текст и карточки остаются читаемыми (не хуже, чем до изменений);
  - при прокрутке длинного раздела (например, «Хроники» или «Персонажи» со списком)
    фон не дёргается и не создаёт видимых полос/швов.

- [ ] **Step 3: Проверить на узком экране**

  В том же браузерном сеансе сузить окно до мобильной ширины (~375px) и повторно
  открыть 2-3 раздела — убедиться, что `cover`-скейлинг не искажает фон и текст
  по-прежнему читается.

- [ ] **Step 4: Commit**

  ```bash
  git add web/public/index.html
  git commit -m "feat: preload dashboard background illustration"
  ```
