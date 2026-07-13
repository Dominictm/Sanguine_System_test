# Книга хроники — Implementation Plan

> superpowers:executing-plans, inline (без субагентов).
> Спека: `docs/superpowers/specs/2026-07-13-chronicle-book-design.md`.

### Task 1: `GET /api/chronicles/:slug/book-data` (TDD)

**Files:** Modify `web/routes/chronicles.js`; Test `web/tests/all.test.js`.

- [ ] Integration-тесты: существующая хроника → 200, `display`,
      `chronicleMd` непуст, `modules[]` (у закрытого модуля `finale` непуст);
      несуществующая → 404.
- [ ] Прогнать — падают.
- [ ] Реализация: читать `chronicles/<slug>/chronicle.md`; модули — readdir
      директорий `chronicles/<slug>/modules/`, для каждого H1 из `<mod>.md`
      (title) + `finale.md` (может быть пустым). Только fs-чтение.
- [ ] Зелёные; commit `feat: GET /api/chronicles/:slug/book-data`.

### Task 2: кнопка «📕 Книга» + сборка документа

**Files:** Modify `web/public/index.html` (кнопка в `.chr-detail-header-btns`),
`web/public/scripts/modules.js` (обработчик + `_chrBuildBook`).

- [ ] Кнопка `<button class="chd-dir-btn" id="chd-book" title="Собрать хронику в читабельную книгу (печать → PDF)">📕 Книга</button>`.
- [ ] `_chrBuildBook()`: `Promise.all([book-data, events])`; хелпер
      `_bookMd(md)` = `mdToHtmlBlock(md.replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, '$1'))`;
      разделы по спеке; `window.open('', '_blank')` → `document.write`
      самодостаточного HTML с инлайн-CSS (тёмная тема + `@media print`
      светлая, `max-width 72ch`, `page-break` перед разделами).
- [ ] `node --check`, тесты, CDP-проверка (новая вкладка содержит титул,
      спину, события, финалы; консоль чистая), уборка, commit
      `feat: «📕 Книга» — компиляция хроники в один документ`.
