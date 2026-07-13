# Дайс-роллер V20 — Implementation Plan

> **For agentic workers:** superpowers:executing-plans, inline (без субагентов).

**Goal:** плавающий d10-роллер по правилам стола (10-again + канон-ботч) с
подстановкой пула из открытого V20-листа
(спека `docs/superpowers/specs/2026-07-13-dice-roller-design.md`).

---

### Task 1: `rollV20Pool` (TDD)

**Files:** Create `web/public/scripts/dice.js`; Test `web/tests/all.test.js`.

- [ ] Step 1: unit-тесты (describe рядом с парсерными):

```js
describe('dice.js — rollV20Pool', () => {
  const { rollV20Pool } = require('../public/scripts/dice.js');
  const seq = arr => { let i = 0; return () => (arr[i++ % arr.length] - 0.5) / 10; }; // rng, дающий ровно эти кубики
  it('успехи и вычет единиц', () => {
    const r = rollV20Pool({ pool: 5, difficulty: 6, rng: seq([7, 8, 3, 1, 6]) });
    assert.deepEqual(r.dice, [7, 8, 3, 1, 6]);
    assert.equal(r.successes, 3); assert.equal(r.ones, 1); assert.equal(r.net, 2);
    assert.equal(r.result, 'success');
  });
  it('ботч: 0 успехов до вычета + единица', () => {
    const r = rollV20Pool({ pool: 3, difficulty: 6, rng: seq([1, 3, 5]) });
    assert.equal(r.result, 'botch');
  });
  it('не ботч, если успех был, но единицы съели всё', () => {
    const r = rollV20Pool({ pool: 3, difficulty: 6, rng: seq([7, 1, 1]) });
    assert.equal(r.net, 0); assert.equal(r.result, 'failure');
  });
  it('10-again: десятка даёт успех и перебрасывается; переброс может успеть', () => {
    const r = rollV20Pool({ pool: 2, difficulty: 6, rng: seq([10, 3, 8]) }); // 10 → переброс 8
    assert.deepEqual(r.dice, [10, 3]); assert.deepEqual(r.rerolls, [8]);
    assert.equal(r.net, 2);
  });
  it('единица на перебросе не вычитает и не ботчит', () => {
    const r = rollV20Pool({ pool: 1, difficulty: 6, rng: seq([10, 1]) });
    assert.equal(r.net, 1); assert.equal(r.result, 'success');
  });
});
```

- [ ] Step 2: прогнать — падают (файла нет).
- [ ] Step 3: реализация (чистая часть dice.js):

```js
'use strict';
// d10-роллер V20 по правилам стола: 10-again (хоусрул) + канонический ботч.
// Чистая логика отделена от виджета и экспортируется для Node-тестов.

function rollV20Pool({ pool, difficulty = 6, rng = Math.random }) {
  const d10 = () => Math.min(10, Math.max(1, Math.floor(rng() * 10) + 1));
  const dice = [];
  for (let i = 0; i < pool; i++) dice.push(d10());
  let successes = dice.filter(d => d >= difficulty).length;
  const ones = dice.filter(d => d === 1).length;
  // 10-again: десятки взрываются (и на перебросах тоже); единицы перебросов
  // не вычитают успехи и не влияют на ботч. Предохранитель — 50 перебросов.
  const rerolls = [];
  let pendingTens = dice.filter(d => d === 10).length;
  while (pendingTens > 0 && rerolls.length < 50) {
    const d = d10();
    rerolls.push(d);
    if (d >= difficulty) successes++;
    pendingTens += (d === 10 ? 1 : 0) - 1;
  }
  const net = Math.max(0, successes - ones);
  const result = (successes - rerolls.filter(d => d >= difficulty).length) === 0 && ones > 0
    ? 'botch' : net >= 1 ? 'success' : 'failure';
  return { dice, rerolls, successes, ones, net, result };
}
```

**Внимание к ботчу:** «0 успехов до вычета» — по исходному пулу; успехи
перебросов существуют только если была десятка (успех) в исходном пуле, так
что при ботче перебросов не бывает — выражение выше эквивалентно
`dice.filter(d => d >= difficulty).length === 0 && ones > 0`; использовать
эту простую форму.

- [ ] Step 4: тесты зелёные. Commit: `feat: rollV20Pool — чистая логика броска V20`

### Task 2: виджет + интеграция с листом

**Files:** Modify `web/public/scripts/dice.js`, `web/public/index.html`
(script-тег + разметка виджета), `web/public/styles.css`.

- [ ] Step 1: разметка в index.html (перед script-тегами):

```html
    <!-- Дайс-роллер V20 (dice.js) -->
    <button id="dice-fab" title="Дайс-роллер V20" aria-label="Дайс-роллер V20">🎲</button>
    <div id="dice-panel" hidden>
      <div class="dice-panel-title">🎲 Бросок V20 <button id="dice-close" aria-label="Закрыть">✕</button></div>
      <div class="dice-sheet-row" id="dice-sheet-row" hidden>
        <select class="form-control" id="dice-attr-sel"><option value="">— атрибут —</option></select>
        <select class="form-control" id="dice-abil-sel"><option value="">— способность —</option></select>
      </div>
      <div class="dice-inputs">
        <label>Пул <input class="form-control" id="dice-pool" type="number" min="1" max="20" value="5"></label>
        <label>Сложность <input class="form-control" id="dice-diff" type="number" min="2" max="10" value="6"></label>
        <button class="chr-modal-btn" id="dice-roll">Бросить</button>
      </div>
      <div id="dice-result"></div>
      <div id="dice-history"></div>
    </div>
```

Script-тег `scripts/dice.js` — перед `scripts/scripts.js`.

- [ ] Step 2: виджет в dice.js: fab toggle; roll-обработчик рендерит кубики
      чипами (10 — золотая, 1 — красная, успех — подсветка), «N успехов» /
      «ПРОВАЛ» / «БОТЧ»; история — массив в памяти, последние 10, новые сверху.
      Селекты: при открытии панели, если `typeof _v20Model !== 'undefined' && _v20Model`,
      заполнить атрибуты (V20_ATTRS, значения из модели) и способности
      (abilities.*, только с name); `change` → pool = attr + abil.
- [ ] Step 3: CSS на токенах: fab fixed справа-снизу, 48×48, `z-index: var(--z-sticky)`
      (или существующий токен слоя), панель — карточка `--bg3`/`--border`,
      кубик-чипы; `@media (pointer: coarse)` уже покрыт размером 48px.
- [ ] Step 4: `node --check`, тесты, живая CDP-проверка (Task 3). Commit:
      `feat: плавающий дайс-роллер V20 с подстановкой пула из листа`

### Task 3: CDP-проверка

- [ ] Открыть любую страницу: fab виден; бросок 5к6 — результат и история;
      открыть персонажа → вкладка «Лист» → селекты заполнены, выбор
      подставляет пул; консоль чистая; полный `npm run test:unit`; уборка.
