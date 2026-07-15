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
  const attrSel = document.getElementById('dice-attr-sel');
  const abilSel = document.getElementById('dice-abil-sel');
  const charSel = document.getElementById('dice-char-sel');
  const _history = []; // последние 10 бросков, в памяти сессии
  let _diceModel = null; // модель листа выбранного персонажа

  // Пул из листа: выбор персонажа прямо в панели (лист открывать не нужно) →
  // fetch sheet-data → селекты «Атрибут/Способность». Если V20-лист уже
  // открыт в модалке, его модель подставляется сразу.
  function _diceFillFromModel(m) {
    _diceModel = m;
    if (!m || !m.attributes) {
      attrSel.disabled = abilSel.disabled = true;
      attrSel.innerHTML = '<option value="">— атрибут —</option>';
      abilSel.innerHTML = '<option value="">— способность —</option>';
      return;
    }
    const attrs = [];
    for (const [group, list] of Object.entries(typeof V20_ATTRS !== 'undefined' ? V20_ATTRS : {})) {
      for (const [key, label] of list) attrs.push({ label, val: (m.attributes[group] || {})[key] || 0 });
    }
    const abils = [];
    for (const group of Object.keys(m.abilities || {})) {
      for (const slot of m.abilities[group]) if (slot.name) abils.push({ label: slot.name, val: slot.val || 0 });
    }
    attrSel.innerHTML = '<option value="">— атрибут —</option>' +
      attrs.map(a => `<option value="${a.val}">${escHtml(a.label)} (${a.val})</option>`).join('');
    abilSel.innerHTML = '<option value="">— способность —</option>' +
      abils.map(a => `<option value="${a.val}">${escHtml(a.label)} (${a.val})</option>`).join('');
    attrSel.disabled = abilSel.disabled = false;
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
    const b = parseInt(abilSel.value) || 0;
    if (attrSel.value !== '' || abilSel.value !== '') poolEl.value = Math.max(1, a + b);
  }
  attrSel.addEventListener('change', _diceApplySheetPool);
  abilSel.addEventListener('change', _diceApplySheetPool);

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
