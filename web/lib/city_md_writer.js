'use strict';
// Точечные мутации уже существующего city.md — техспека 2026-08-04 §A1.
//
// Зачем отдельный модуль, а не lib/parsers/city.js: тот отвечает за ЧТЕНИЕ
// (parseCityMd) и сборку файла С НУЛЯ (buildCityMd). Здесь — правка существующего
// текста на месте, с сохранением всего, что не затронуто.
//
// Первопричина: PUT /api/cities с `fields` раньше делал полный buildCityMd-ребилд,
// то есть пересобирал файл из 16 канонических секций. Рукописный city.md (Париж:
// таблицы, блок-цитаты, ###-подзаголовки, своя секция «Уточняющие вопросы…») это
// необратимо разбирало, поэтому фронтенд был вынужден ЗАПРЕЩАТЬ структурное
// редактирование таким городам. Точечная запись снимает и первопричину, и запрет.

const { CITY_SECTIONS, citySectionBody } = require('./parsers/city');

const BOM = '﻿';
const PLACEHOLDER = '- …';

function _escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// BOM снимается перед любой обработкой и возвращается при сборке результата:
// иначе он попадает внутрь первого совпадения и ломает якорь `^#` у H1.
function _splitBom(raw) {
  const text = String(raw == null ? '' : raw);
  return text.charCodeAt(0) === 0xFEFF
    ? { bom: BOM, text: text.slice(1) }
    : { bom: '', text };
}

/**
 * Границы секции `## heading` в тексте (без BOM).
 * Регистронезависимо — как headingToKey в parseCityMd (тот тоже lowercase-ит).
 * @returns {{headStart:number, bodyStart:number, bodyEnd:number}|null}
 */
function _sectionSpan(text, heading) {
  const re = new RegExp(`^##[ \\t]+${_escapeRe(heading)}[ \\t]*$`, 'mi');
  const m = re.exec(text);
  if (!m) return null;
  const afterHeading = m.index + m[0].length;
  // Тело начинается со следующей строки; если файл кончился на заголовке — тело пустое.
  const bodyStart = afterHeading < text.length ? afterHeading + 1 : afterHeading;
  const rest = text.slice(bodyStart);
  const nextIdx = rest.search(/^##[ \t]+/m);
  return {
    headStart: m.index,
    bodyStart,
    bodyEnd: nextIdx === -1 ? text.length : bodyStart + nextIdx,
  };
}

/** Пустое значение секции → канонический плейсхолдер (его же пишет buildCityMd). */
function _bodyOrPlaceholder(bodyText) {
  const v = String(bodyText == null ? '' : bodyText).replace(/\s+$/, '');
  return v.trim() ? v : PLACEHOLDER;
}

/**
 * Заменяет ТЕЛО секции `## heading` произвольным текстом, не трогая ничего за её
 * пределами. Возвращает null, если заголовка в файле нет (вызывающий решает —
 * пропустить синк или вставить секцию через upsertCitySection).
 * @param {string} raw
 * @param {string} heading — человекочитаемый заголовок («Фракции», «Районы», …)
 * @param {string} bodyText — произвольный многострочный текст тела
 * @returns {string|null}
 */
function replaceCitySection(raw, heading, bodyText) {
  const { bom, text } = _splitBom(raw);
  const span = _sectionSpan(text, heading);
  if (!span) return null;
  const body = _bodyOrPlaceholder(bodyText);
  // Хвостовые переводы строк исходного тела сохраняем как были: buildCityMd разделяет
  // секции пустой строкой, и схлопывание её здесь давало бы диff на ровном месте
  // (round-trip «прочитал → записал то же» обязан быть байт-в-байт, §A1.6).
  const trail = (text.slice(span.bodyStart, span.bodyEnd).match(/\n*$/) || [''])[0] || '\n';
  return bom + text.slice(0, span.bodyStart) + body + trail + text.slice(span.bodyEnd);
}

/**
 * Как replaceCitySection, но при отсутствии секции ВСТАВЛЯЕТ её в каноническое
 * место (техспека §A1.5): сразу после ближайшей предшествующей по CITY_SECTIONS
 * секции, которая реально есть в файле; если таких нет — перед первой «## »;
 * если «## » нет вовсе — в конец.
 * @returns {{text: string, created: boolean}}
 */
function upsertCitySection(raw, heading, bodyText) {
  const replaced = replaceCitySection(raw, heading, bodyText);
  if (replaced !== null) return { text: replaced, created: false };

  const { bom, text } = _splitBom(raw);
  const body = _bodyOrPlaceholder(bodyText);
  const block = `## ${heading}\n${body}\n`;

  const order = CITY_SECTIONS.map(([, h]) => h);
  const selfIdx = order.findIndex(h => h.toLowerCase() === String(heading).toLowerCase());

  // Ближайшая ПРЕДШЕСТВУЮЩАЯ каноническая секция, присутствующая в файле.
  if (selfIdx > 0) {
    for (let i = selfIdx - 1; i >= 0; i--) {
      const span = _sectionSpan(text, order[i]);
      if (!span) continue;
      const head = text.slice(0, span.bodyEnd).replace(/\s*$/, '\n');
      const tail = text.slice(span.bodyEnd).replace(/^\n+/, '');
      return { text: `${bom}${head}\n${block}\n${tail}`, created: true };
    }
  }

  // Предшествующих нет — ставим перед первой существующей секцией (после интро).
  const firstIdx = text.search(/^##[ \t]+/m);
  if (firstIdx !== -1) {
    const head = text.slice(0, firstIdx).replace(/\s*$/, '\n');
    return { text: `${bom}${head}\n${block}\n${text.slice(firstIdx)}`, created: true };
  }

  // Секций нет вообще — дописываем в конец.
  return { text: `${bom}${text.replace(/\s*$/, '\n')}\n${block}`, created: true };
}

/**
 * Обратно-совместимая обёртка для синка СПИСКОВ (Фракции, Районы): массив имён →
 * буллет-список. Пустой массив → плейсхолдер, как у buildCityMd.
 * @param {string[]} names
 * @returns {string|null}
 */
function replaceCitySectionBullets(raw, heading, names) {
  const list = (Array.isArray(names) ? names : []).map(n => String(n).trim()).filter(Boolean);
  return replaceCitySection(raw, heading, list.map(n => `- ${n}`).join('\n'));
}

/**
 * Запись секции ИЗ ФОРМЫ: значение прогоняется через ту же нормализацию
 * («строка на пункт» → буллеты), что применял buildCityMd, — иначе сохранение
 * распарсенного значения обратно теряло бы буллеты и меняло файл на ровном месте.
 * Секция создаётся, если её нет (§A1.5).
 * @returns {{text: string, created: boolean}}
 */
function upsertCitySectionFromForm(raw, heading, formValue) {
  return upsertCitySection(raw, heading, citySectionBody(formValue));
}

/**
 * Переписывает H1 в канонический вид `# {display}, {year} — сеттинг города`.
 * Пустые display/year — не трогаем заголовок вовсе (техспека §A1.6).
 */
function setCityTitle(raw, display, year) {
  const { bom, text } = _splitBom(raw);
  const d = String(display == null ? '' : display).trim();
  const y = String(year == null ? '' : year).trim();
  if (!d && !y) return bom + text;

  const m = /^#[ \t]+.*$/m.exec(text);
  if (!m) return bom + text; // без H1 сюда не доходим — PUT валидирует его раньше

  // Недостающую половину берём из текущего заголовка, чтобы правка одного поля
  // не сносила второе (форма всегда шлёт оба, но модуль не должен на это полагаться).
  const cur = m[0].replace(/^#[ \t]+/, '').replace(/\s*—\s*сеттинг города\s*$/i, '').trim();
  const curM = cur.match(/^(.*?),\s*([^,]+?)\s*$/);
  const display2 = d || (curM ? curM[1].trim() : cur);
  const year2    = y || (curM ? curM[2].trim() : '');

  const title = year2 ? `# ${display2}, ${year2} — сеттинг города` : `# ${display2} — сеттинг города`;
  return bom + text.slice(0, m.index) + title + text.slice(m.index + m[0].length);
}

/**
 * Заменяет блок описания — текст между H1 и первой секцией «## ».
 * Пустой text → описание вычищается (абзац исчезает, структура файла остаётся).
 */
function setCityDescription(raw, descText) {
  const { bom, text } = _splitBom(raw);
  const h1 = /^#[ \t]+.*$/m.exec(text);
  if (!h1) return bom + text;

  const afterH1 = h1.index + h1[0].length;
  const rest = text.slice(afterH1);
  const nextIdx = rest.search(/^##[ \t]+/m);
  const introEnd = nextIdx === -1 ? text.length : afterH1 + nextIdx;

  const v = String(descText == null ? '' : descText).trim();
  const intro = v ? `\n\n${v}\n\n` : '\n\n';
  return bom + text.slice(0, afterH1) + intro + text.slice(introEnd);
}

/**
 * Заголовки «## », не входящие в канонический набор — рукописные секции города.
 * Нужен и серверу (диагностика), и фронтенду (информирующая плашка вместо запрета).
 * @returns {string[]}
 */
function customCitySections(raw) {
  const { text } = _splitBom(raw);
  const known = new Set(CITY_SECTIONS.map(([, h]) => h.toLowerCase()));
  return [...text.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)]
    .map(m => m[1].trim())
    .filter(h => !known.has(h.toLowerCase()));
}

module.exports = {
  replaceCitySection,
  replaceCitySectionBullets,
  upsertCitySection,
  upsertCitySectionFromForm,
  setCityTitle,
  setCityDescription,
  customCitySections,
};
