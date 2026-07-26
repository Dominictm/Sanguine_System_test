'use strict';
// d10-роллер V20 по правилам стола: 10-again (хоусрул, выбор пользователя)
// + канонический ботч V20. Чистая логика (rollV20Pool) отделена от виджета
// и экспортируется для Node-тестов через module.exports в конце файла.

// ═══════════════════════════════════════════════════════════════
// Чистая логика броска
// ═══════════════════════════════════════════════════════════════

// { pool, difficulty=6, rng=Math.random } →
// { dice, rerolls, successes, ones, net, result: 'botch'|'failure'|'success' }
// Правила: успех — кубик ≥ сложности; десятки взрываются (перебросы могут
// успевать и взрываться дальше, предохранитель 50); единицы ИСХОДНОГО пула
// вычитают успехи; единицы перебросов не вычитают и не влияют на ботч;
// ботч = 0 успехов в исходном пуле И хотя бы одна единица.
function rollV20Pool({ pool, difficulty = 6, rng = Math.random }) {
  const d10 = () => Math.min(10, Math.max(1, Math.floor(rng() * 10) + 1));
  const dice = [];
  for (let i = 0; i < pool; i++) dice.push(d10());
  const baseSuccesses = dice.filter(d => d >= difficulty).length;
  const ones = dice.filter(d => d === 1).length;

  const rerolls = [];
  let successes = baseSuccesses;
  let pendingTens = dice.filter(d => d === 10).length;
  while (pendingTens > 0 && rerolls.length < 50) {
    const d = d10();
    rerolls.push(d);
    if (d >= difficulty) successes++;
    pendingTens += (d === 10 ? 1 : 0) - 1;
  }

  const net = Math.max(0, successes - ones);
  const result = baseSuccesses === 0 && ones > 0 ? 'botch'
    : net >= 1 ? 'success' : 'failure';
  return { dice, rerolls, successes, ones, net, result };
}

// ═══════════════════════════════════════════════════════════════
// Виджет (только в браузере)
// ═══════════════════════════════════════════════════════════════

if (typeof document !== 'undefined' && document.getElementById('dice-fab')) {
  const fab     = document.getElementById('dice-fab');
  const panel   = document.getElementById('dice-panel');
  const poolEl  = document.getElementById('dice-pool');
  const diffEl  = document.getElementById('dice-diff');
  const resEl   = document.getElementById('dice-result');
  const histEl  = document.getElementById('dice-history');
  const attrSel   = document.getElementById('dice-attr-sel');
  const abilSel   = document.getElementById('dice-abil-sel');
  const virtueSel = document.getElementById('dice-virtue-sel');
  const charSel   = document.getElementById('dice-char-sel');
  const unskilledBadge = document.getElementById('dice-unskilled-badge');
  const _history = []; // последние 10 бросков, в памяти сессии
  let _diceModel = null; // модель листа выбранного персонажа
  let _diceUnskilled = false; // выбрано «Не владеет» в abilSel → +2 к сложности

  // dataset.base — БАЗОВАЯ (введённая пользователем) сложность, отдельно от
  // эффективной (с учётом штрафа «Не владеет»). Обновляется только при ручном
  // вводе пользователя (см. слушатель ниже) и при инициализации/смене
  // персонажа — никогда не читается из текущего diffEl.value внутри
  // _diceSetUnskilled, иначе повторное переключение накопит +2.
  diffEl.dataset.base = diffEl.value || '6';
  diffEl.addEventListener('input', () => { diffEl.dataset.base = diffEl.value; });
  diffEl.addEventListener('change', () => { diffEl.dataset.base = diffEl.value; });

  function _diceSetUnskilled(flag) {
    _diceUnskilled = flag;
    const base = parseInt(diffEl.dataset.base, 10) || 6;
    diffEl.value = base + (flag ? 2 : 0); // программная установка .value не шлёт input/change
    if (unskilledBadge) unskilledBadge.hidden = !flag;
  }

  // 2.3: третий список — добродетели (Совесть/Самоконтроль/Смелость) + Сила воли в
  // одном селекте «Добродетель». Без модели — только имена, без чисел (2.1).
  function _diceFillVirtues(m) {
    if (!virtueSel) return;
    const has = !!(m && m.virtues && m.willpower);
    const items = [
      ['Совесть/Решимость', has ? m.virtues.conscience : null],
      ['Самоконтроль/Инстинкты', has ? m.virtues.selfcontrol : null],
      ['Смелость', has ? m.virtues.courage : null],
      ['Сила воли', has ? m.willpower.permanent : null],
    ];
    virtueSel.innerHTML = '<option value="">— добродетель —</option>' +
      items.map(([label, val]) => {
        const known = val !== null && val !== undefined;
        return `<option value="${known ? val : ''}">${escHtml(label)}${known ? ` (${val})` : ''}</option>`;
      }).join('');
  }

  // Пул из листа: выбор персонажа прямо в панели (лист открывать не нужно) →
  // fetch sheet-data → селекты «Атрибут/Способность/Добродетель». Если V20-лист
  // уже открыт в модалке, его модель подставляется сразу.
  function _diceFillFromModel(m) {
    _diceModel = m;
    // Селекты пересобираются заново — предыдущий выбор «Не владеет» (если был) больше не
    // отражён в разметке, поэтому синхронизируем флаг/сложность в конце функции (не трогая
    // dataset.base — пользовательскую сложность между персонажами не сбрасываем).
    attrSel.disabled = abilSel.disabled = false; // 2.1: списки доступны и без персонажа
    if (!m || !m.attributes) {
      // 2.1: без персонажа — полный статический список из V20_ATTRS/V20_ABILITIES,
      // значения неизвестны (без чисел в скобках); пул — ручной ввод.
      const attrLabels = [];
      for (const [, list] of Object.entries(typeof V20_ATTRS !== 'undefined' ? V20_ATTRS : {}))
        for (const [, label] of list) attrLabels.push(label);
      const abilLabels = [];
      for (const [, list] of Object.entries(typeof V20_ABILITIES !== 'undefined' ? V20_ABILITIES : {}))
        for (const label of list) abilLabels.push(label);
      attrSel.innerHTML = '<option value="">— атрибут —</option>' +
        attrLabels.map(label => `<option value="">${escHtml(label)}</option>`).join('');
      abilSel.innerHTML = '<option value="">— способность —</option>' +
        abilLabels.map(label => `<option value="">${escHtml(label)}</option>`).join('') +
        '<option value="unskilled">Не владеет</option>';
      _diceFillVirtues(null);
      _diceSetUnskilled(false);
      return;
    }
    // 2.2: только прокачанные (val > 0) — нулевые атрибуты/способности (напр.
    // Внешность Носферату, непрокачанные навыки) для броска бессмысленны.
    const attrs = [];
    for (const [group, list] of Object.entries(typeof V20_ATTRS !== 'undefined' ? V20_ATTRS : {})) {
      for (const [key, label] of list) {
        const val = (m.attributes[group] || {})[key] || 0;
        if (val > 0) attrs.push({ label, val });
      }
    }
    const abils = [];
    for (const group of Object.keys(m.abilities || {})) {
      for (const slot of m.abilities[group]) {
        const val = slot.val || 0;
        if (slot.name && val > 0) abils.push({ label: slot.name, val });
      }
    }
    attrSel.innerHTML = '<option value="">— атрибут —</option>' +
      attrs.map(a => `<option value="${a.val}">${escHtml(a.label)} (${a.val})</option>`).join('');
    // «Не владеет» — синтетическая опция, есть всегда, даже если у персонажа нет
    // собственных нулевых способностей: штраф +2 к сложности за бросок неосвоенным навыком.
    abilSel.innerHTML = '<option value="">— способность —</option>' +
      abils.map(a => `<option value="${a.val}">${escHtml(a.label)} (${a.val})</option>`).join('') +
      '<option value="unskilled">Не владеет</option>';
    _diceFillVirtues(m);
    _diceSetUnskilled(false);
  }

  async function _diceFillCharSelect() {
    if (typeof ensureCharsLoaded === 'function') await ensureCharsLoaded();
    const chars = (typeof STATE !== 'undefined' && STATE.characters || []).filter(c => c.hasSheet && c.name);
    const openName = (typeof _v20Model !== 'undefined' && _v20Model && typeof _v20Ctx !== 'undefined' && _v20Ctx) ? _v20Ctx.name : null;
    const current = charSel.value;
    charSel.innerHTML = '<option value="">— персонаж —</option>' +
      chars.map(c => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`).join('');
    if (openName && chars.some(c => c.name === openName)) {
      charSel.value = openName;
      _diceFillFromModel(_v20Model);
    } else if (current && chars.some(c => c.name === current)) {
      charSel.value = current; // сохранить выбор между открытиями панели
      // _diceFillFromModel для current намеренно не вызывается: attrSel/abilSel/
      // virtueSel — отдельные от charSel элементы, innerHTML выше их не трогает,
      // поэтому их прошлый рендер (заполненный при исходном выборе через 'change'
      // на charSel) остаётся в DOM как есть между открытиями/закрытиями панели.
    } else if (attrSel.options.length <= 1) {
      // 2.1: ни открытого листа, ни сохранённого выбора нет — но это может быть
      // либо самое первое открытие панели на свежей странице (attrSel всё ещё в
      // исходном disabled-состоянии разметки index.html, только placeholder-опция),
      // либо повторное открытие без персонажа. Разграничиваем по факту заполненности
      // селекта: только на первом случае нужен полный статический список +
      // снятие disabled; при повторном открытии без персонажа селекты уже заполнены
      // этим же путём раньше и хранят сделанный пользователем выбор (в т.ч. «Не
      // владеет» и вручную выставленную сложность) — трогать их не нужно (см. cca8ff6).
      _diceFillFromModel(null);
    }
  }

  charSel.addEventListener('change', async () => {
    const name = charSel.value;
    if (!name) { _diceFillFromModel(null); return; }
    // Лист этого персонажа уже открыт в модалке — модель свежее, чем на диске.
    if (typeof _v20Model !== 'undefined' && _v20Model && typeof _v20Ctx !== 'undefined' && _v20Ctx?.name === name) {
      _diceFillFromModel(_v20Model);
      return;
    }
    attrSel.innerHTML = '<option value="">…</option>';
    try {
      const d = await fetch(`/api/characters/${encodeURIComponent(_charSlug(name))}/sheet-data${location.search}`).then(r => r.json());
      // _v20ModelFrom (v20-sheet.js) понимает оба источника: JSON-модель и
      // AI-markdown (source:'md' — сырой d.data пуст, модель парсится из md).
      _diceFillFromModel(d.exists ? _v20ModelFrom(d) : null);
    } catch { _diceFillFromModel(null); }
  });

  function _diceApplySheetPool() {
    const a = parseInt(attrSel.value) || 0;
    // «Не владеет» → 0 к пулу явно (не полагаемся на parseInt('unskilled') → NaN → 0 случайно).
    const b = abilSel.value === 'unskilled' ? 0 : (parseInt(abilSel.value) || 0);
    if (attrSel.value !== '' || abilSel.value !== '') poolEl.value = Math.max(1, a + b);
  }
  // 2.3: добродетель — самостоятельный пул (не сумма с атрибутом/способностью); порядок
  // выбора решает, что «выигрывает» — последний применённый селект перезаписывает #dice-pool.
  function _diceApplyVirtuePool() {
    if (!virtueSel || virtueSel.value === '') return;
    const v = parseInt(virtueSel.value, 10);
    if (!isNaN(v)) poolEl.value = Math.max(1, v);
  }
  // 2.1: без персонажа (_diceModel === null) выбор в списках — чисто информационный
  // (для истории броска), #dice-pool остаётся ручным вводом — _diceApplySheetPool не
  // вызывается, чтобы не просуммировать несуществующие числа.
  attrSel.addEventListener('change', () => { if (_diceModel) _diceApplySheetPool(); });
  abilSel.addEventListener('change', () => {
    _diceSetUnskilled(abilSel.value === 'unskilled');
    if (_diceModel) _diceApplySheetPool();
  });
  if (virtueSel) virtueSel.addEventListener('change', () => { if (_diceModel) _diceApplyVirtuePool(); });

  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) _diceFillCharSelect();
  });
  document.getElementById('dice-close').addEventListener('click', () => { panel.hidden = true; });

  function _diceChips(r, difficulty) {
    let i = 0; // индекс для каскада появления (CSS --i)
    const chip = (d, reroll) =>
      `<span class="dice-chip${d >= difficulty ? ' hit' : ''}${d === 10 ? ' ten' : ''}${d === 1 && !reroll ? ' one' : ''}${reroll ? ' reroll' : ''}" style="--i:${i++}">${d}</span>`;
    return r.dice.map(d => chip(d, false)).join('') +
      (r.rerolls.length ? `<span class="dice-sep">↻</span>` + r.rerolls.map(d => chip(d, true)).join('') : '');
  }

  function _diceVerdict(r) {
    if (r.result === 'botch') return '<span class="dice-verdict botch">БОТЧ</span>';
    if (r.result === 'failure') return '<span class="dice-verdict fail">Провал</span>';
    const n = r.net;
    const word = n % 10 === 1 && n % 100 !== 11 ? 'успех'
      : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'успеха' : 'успехов');
    return `<span class="dice-verdict ok">${n} ${word}</span>`;
  }

  document.getElementById('dice-roll').addEventListener('click', () => {
    const pool = Math.min(20, Math.max(1, parseInt(poolEl.value) || 1));
    const difficulty = Math.min(10, Math.max(2, parseInt(diffEl.value) || 6));
    poolEl.value = pool; diffEl.value = difficulty;
    const r = rollV20Pool({ pool, difficulty });
    resEl.innerHTML = `<div class="dice-dice">${_diceChips(r, difficulty)}</div>${_diceVerdict(r)}`;
    _history.unshift({ pool, difficulty, r });
    if (_history.length > 10) _history.pop();
    histEl.innerHTML = _history.map(h =>
      `<div class="dice-hist-row">${h.pool}к${h.difficulty} → ${
        h.r.result === 'botch' ? 'ботч' : h.r.result === 'failure' ? 'провал' : h.r.net + ' усп.'
      }</div>`).join('');
  });
}

if (typeof module !== 'undefined') module.exports = { rollV20Pool };
