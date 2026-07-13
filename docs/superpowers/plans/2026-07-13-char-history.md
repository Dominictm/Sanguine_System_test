# История изменений карточки — Implementation Plan

> superpowers:executing-plans, inline (без субагентов).
> Спека: `docs/superpowers/specs/2026-07-13-char-history-design.md`.

### Task 1: эндпойнты (TDD)

**Files:** Modify `web/routes/characters.js`; Test `web/tests/all.test.js`.

- [ ] Integration-тесты (describe рядом с character-тестами): history
      существующего персонажа → `available:true`, commits с hash/date/subject;
      несуществующий slug → 404; невалидный hash → 400; diff валидного
      коммита содержит `diff --git`.
- [ ] Прогнать — падают (404 route).
- [ ] Реализация: `execFile('git', ['log','--follow','-n','50','--format=%h%x09%cs%x09%s','--', relPath], { cwd: ROOT })`;
      относительный путь карточки из `_resolveChar` (`characters/<lineageFolder>/<slug>/<slug>.md` внутри `cityDir`);
      ошибки git → `{available:false, commits:[]}` (200). Дифф —
      `git show <hash> -- <relPath>`, hash по `/^[0-9a-f]{7,40}$/i`.
- [ ] Тесты зелёные; commit `feat: GET /api/characters/:slug/history — git-история карточки`.

### Task 2: вкладка «История» в модалке персонажа

**Files:** Modify `web/public/scripts/char-detail.js`, `web/public/styles.css`.

- [ ] Кнопка `<button class="cdet-tab" data-tab="history" data-char=...>История</button>`
      после «Описание» + пустая панель `data-panel="history"`; в делегате
      таба: `if (tab.dataset.tab === 'history') _loadCharHistory(tab.dataset.char);`
- [ ] `_loadCharHistory(name)`: лениво, кэш на панели (`data-loaded`);
      slug — как `_loadCharSheet` получает (проверить: по имени → STATE);
      рендер списка коммитов; клик по строке → fetch диффа → `<pre>` с
      подсветкой +/- (классы `.hist-add`/`.hist-del` на токенах).
- [ ] CSS: `.cdet-hist-row` (≥44px coarse), `.cdet-hist-diff` (overflow-x auto).
- [ ] `node --check`, тесты, CDP-проверка, commit
      `feat: вкладка «История» (git) в модалке персонажа`.
