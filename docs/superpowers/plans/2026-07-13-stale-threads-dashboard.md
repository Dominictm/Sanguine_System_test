# Дашборд «висящих нитей» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans,
> inline (без субагентов — по решению пользователя).

**Goal:** топ давно не двигавшихся нитей на дашборде
(спека `docs/superpowers/specs/2026-07-13-stale-threads-dashboard-design.md`).

**Architecture:** чистый экстрактор игровой даты в `parsers/threads.js` →
аддитивные поля `sourceDate`/`staleMonths` в `GET /api/threads` → блок в
`renderDashboard` с параллельным fetch.

---

### Task 1: `threadSourceDate` + поля в GET /api/threads (TDD)

**Files:**
- Modify: `web/lib/parsers/threads.js`
- Modify: `web/routes/threads.js` (`readThreadsStructured`)
- Test: `web/tests/all.test.js`

- [ ] Step 1: unit-тесты (новый describe рядом с тестами парсеров):

```js
describe('parsers/threads.js — threadSourceDate', () => {
  const { threadSourceDate } = require('../lib/parsers');
  it('извлекает месяц+год из хвоста источника', () => {
    assert.deepEqual(threadSourceDate('«Кошки и мышки», ноябрь 2010'), { year: 2010, month: 11 });
    assert.deepEqual(threadSourceDate('«Деньги не проблема», январь 2011 ⟨котерия ДНП⟩'), { year: 2011, month: 1 });
  });
  it('при нескольких датах берёт последнюю', () => {
    assert.deepEqual(threadSourceDate('Карточка; «Цирк», сентябрь 2009; финал, декабрь 2010'), { year: 2010, month: 12 });
  });
  it('без даты или только год → null', () => {
    assert.equal(threadSourceDate('Карточка Верене; «Кошки и мышки»'), null);
    assert.equal(threadSourceDate('архив 2010'), null);
  });
});
```

Integration (в существующий describe threads или рядом):

```js
it('GET /api/threads — элементы имеют staleMonths относительно самой свежей нити', async () => {
  const { status, body } = await apiJson(`/api/threads${CITY}`);
  assert.equal(status, 200);
  const dated = body.filter(t => t.staleMonths !== null && t.staleMonths !== undefined);
  assert.ok(dated.length > 0);
  assert.ok(dated.some(t => t.staleMonths === 0)); // самая свежая
  assert.ok(dated.every(t => t.staleMonths >= 0));
});
```

- [ ] Step 2: прогнать — падают (функции/поля нет).
- [ ] Step 3: реализация `threads.js`:

```js
const RU_MONTH_STEMS = { янв:1, фев:2, март:3, мар:3, апр:4, мая:5, май:5, июн:6, июл:7, авг:8, сент:9, сен:9, окт:10, нояб:11, ноя:11, дек:12 };
function threadSourceDate(source) {
  let last = null;
  const re = /([а-яё]+)\s+(\d{4})/gi;
  let m;
  while ((m = re.exec(source || '')) !== null) {
    const stem = Object.keys(RU_MONTH_STEMS).find(s => m[1].toLowerCase().startsWith(s));
    if (stem) last = { year: parseInt(m[2]), month: RU_MONTH_STEMS[stem] };
  }
  return last;
}
```

(Ключи со стемами перекрываются — искать по убыванию длины стема, чтобы
«март» не матчился как «мар» с тем же результатом; фактически значения
совпадают, но код должен быть однозначным.)

- [ ] Step 4: `readThreadsStructured` — после сбора threads:

```js
const dates = threads.map(t => threadSourceDate(t.source));
const keys  = dates.filter(Boolean).map(d => d.year * 12 + d.month);
const ref   = keys.length ? Math.max(...keys) : null;
threads.forEach((t, i) => {
  t.sourceDate  = dates[i];
  t.staleMonths = (ref !== null && dates[i]) ? ref - (dates[i].year * 12 + dates[i].month) : null;
});
```

- [ ] Step 5: тесты зелёные; report.html откатить. Commit:
      `feat: staleMonths (игровая давность) в GET /api/threads`

### Task 2: блок на дашборде

**Files:**
- Modify: `web/public/scripts/scripts.js` (`loadDashboard`, `renderDashboard`)
- Modify: `web/public/styles.css` (минимальные правила на токенах)

- [ ] Step 1: `loadDashboard` — параллельный fetch нитей (сбой → null):

```js
const [stats, threads] = await Promise.all([
  fetch('/api/status').then(r => r.json()),
  fetch('/api/threads' + (window.location.search || '')).then(r => r.json()).catch(() => null),
]);
renderDashboard(stats, el, threads);
```

- [ ] Step 2: в `renderDashboard(s, container, threads)` перед
      `integrity-row` — блок:

```js
const stale = (threads || [])
  .filter(t => (t.status === 'active' || t.status === 'background') && t.staleMonths >= 1)
  .sort((a, b) => b.staleMonths - a.staleMonths)
  .slice(0, 5);
const ruMonths = n => n % 10 === 1 && n % 100 !== 11 ? 'месяц' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'месяца' : 'месяцев');
const staleBlock = stale.length ? `
  <div class="dash-stale-threads">
    <div class="dash-stale-title">🧵 Висящие нити</div>
    ${stale.map(t => `
      <button class="dash-stale-row" data-nav="threads">
        <span class="dash-stale-dot ${t.status}"></span>
        <span class="dash-stale-name">${escHtml(t.title)}</span>
        <span class="dash-stale-age">${t.staleMonths} ${ruMonths(t.staleMonths)} без движения</span>
      </button>`).join('')}
  </div>` : '';
```

Клик — существующий делегат `[data-nav]` (проверить, что он навигирует без
`data-tab`; иначе — свой мелкий обработчик).

- [ ] Step 3: CSS на токенах, touch ≥44px на `pointer: coarse`.
- [ ] Step 4: тесты зелёные (`node --check`); commit:
      `feat: блок «Висящие нити» на дашборде`

### Task 3: CDP-проверка

- [ ] Дашборд Парижа: блок виден, ≤5 строк, отсортированы по убыванию
      давности, клик ведёт на «Нити», консоль/сеть чистые; уборка следов;
      полный `npm run test:unit`.
