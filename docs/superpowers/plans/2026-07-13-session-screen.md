# Экран сессии — Implementation Plan

> **For agentic workers:** superpowers:executing-plans, inline (без субагентов).

**Goal:** страница «Сессия» для живой игры
(спека `docs/superpowers/specs/2026-07-13-session-screen-design.md`).

**Architecture:** новый classic-script `web/public/scripts/session-screen.js`
(глобальный скоуп), секция `#page-session` + пункт навигации, композиция
существующих API (`/api/chronicles*`, `/detail`, `/api/audio/presets`) и
глобальных функций (`openCharDetail`, `loadAudioLibrary`,
`_audioPresetPlay/_audioPresetStop`, `navigate`). Серверных изменений нет.

---

### Task A: каркас — страница, выбор хроники/модуля, сценарий по сценам

**Files:**
- Create: `web/public/scripts/session-screen.js`
- Modify: `web/public/index.html` — nav-item «Сессия» (после «Модули»),
  секция `#page-session` (после `#page-modules`... фактически после любой),
  script-тег перед `scripts/scripts.js`
- Modify: `web/public/scripts/scripts.js` — строка
  `if (page === 'session') loadSessionScreen();` в navigate()
- Modify: `web/public/styles.css` — сетка/аккордеон на токенах

Ключевые элементы `#page-session`:

```html
<section id="page-session" class="page">
  <div class="page-header">
    <h1 class="page-title">Сессия</h1>
    <span class="page-sub">Режим живой игры</span>
  </div>
  <div class="sess-picker">
    <select class="form-control" id="sess-chr-sel"><option value="">— хроника —</option></select>
    <select class="form-control" id="sess-mod-sel" disabled><option value="">— модуль —</option></select>
  </div>
  <div class="sess-grid">
    <div class="sess-main">
      <div class="sess-scene-nav" id="sess-scene-nav" hidden>
        <button class="chr-modal-btn" id="sess-prev">← Сцена</button>
        <span id="sess-scene-label"></span>
        <button class="chr-modal-btn" id="sess-next">Сцена →</button>
      </div>
      <div id="sess-scenario"><div class="cdet-empty">Выбери хронику и модуль</div></div>
    </div>
    <aside class="sess-side">
      <div id="sess-npcs"></div>
      <div id="sess-audio"></div>
      <div id="sess-notes-wrap"></div>
    </aside>
  </div>
</section>
```

session-screen.js (каркас):
- `loadSessionScreen()` — грузит хроники (`/api/chronicles` + qs города),
  заполняет `#sess-chr-sel`, восстанавливает выбор из
  `localStorage['sanguine.session.' + city]` (`{chr, mod, scene}`),
  триггерит цепочку.
- Выбор хроники → `/api/chronicles/:slug/modules` → `#sess-mod-sel`.
- Выбор модуля → `/detail` → `_sessDetail`; сценарий режется
  `raw.split(/\n(?=##\s+)/)` на блоки `{heading, body}`; рендер аккордеоном:
  один блок развёрнут (`_sessScene`), «← / →» и клик по заголовку блока
  переключают; всё сохраняется в localStorage.
- Пустой сценарий → «Сценарий не сгенерирован» + подсказка про страницу модуля.

- [ ] Разметка + script-тег + navigate()-ветка
- [ ] session-screen.js каркас
- [ ] CSS (sess-grid 2 колонки → 1 на узких, аккордеон)
- [ ] `node --check`, тесты, commit `feat: экран сессии — каркас и сценарий по сценам`

### Task B: НПС + аудио

- `#sess-npcs`: из `_sessDetail.pcs/npcs` — чипы `.sess-npc-chip`;
  `resolveCharByName(name)` (archive.js, глобальная) → есть карточка →
  `openCharDetail(name)` по клику; нет — span без клика.
- `#sess-audio`: `GET /api/audio/presets` (+qs) → пресеты с
  `locationSlug ∈ slugs локаций модуля` (из `_sessDetail.locations`,
  беря их slug-поле; если у локаций нет slug — все пресеты) сверху с
  пометкой 📍, остальные ниже; кнопка ▶/⏹:
  `if (!_audioLibCache) await loadAudioLibrary();` затем
  `_audioPresetPlay(p.id)` / `_audioPresetStop()`; активный подсвечен.
- [ ] Рендер + обработчики, CSS, CDP-smoke, commit
      `feat: экран сессии — НПС и аудио-пресеты`

### Task C: заметки + передача в запись сессии

- `#sess-notes-wrap`: `<textarea id="sess-notes">` (автосохранение в тот же
  localStorage-ключ, debounce 500мс) + кнопка «→ Записать сессию»:
  `navigate('tools')`; активировать вкладку `data-tab="log-session"`
  (клик по `.tab-btn[data-tab="log-session"]`); если `#ls-summary` пуст —
  вставить заметки; если селект хроники пуст — выставить хронику/модуль.
- [ ] Реализация + CDP, commit `feat: экран сессии — заметки и передача в запись`

### Task D: CDP-проверка всей фазы

- [ ] Полный сценарий по спеке; уборка; полный `npm run test:unit`;
      `Get-CimInstance` — нет висящих Chrome.
