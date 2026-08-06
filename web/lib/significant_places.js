'use strict';
// Общая модель «Значимых мест» города (Отмеченные локации) — список допустимых
// типов, парсинг/сериализация строк секции «Ключевые локации» city.md,
// сопоставление имени локации с записью. Используется и прямым синком
// (город → локация, routes/cities.js), и обратной записью (локация → город,
// routes/locations.js). Вынесено в общий модуль, чтобы не дублировать
// парсинг/сопоставление между роутерами (2026-08-06, техспека «Статус
// заменяет Зону»).

const CITY_LOCATION_TYPES = ['Элизиум', 'Приёмная князя', 'Убежище', 'Шериф', 'Сенешаль'];

// Строка секции → { type, name, note } | null, если строка не структурная
// (свободный текст/нарратив). Та же валидация лейбла/значения, что уже
// проверена на реальных данных Парижа (техспека city-creation-restructure §8.1).
function parseLocationLine(line) {
  const ci = line.indexOf(':');
  if (ci <= 0 || ci > 40) return null;
  const label = line.slice(0, ci).trim();
  let value = line.slice(ci + 1).trim();
  let note = '';
  const dashIdx = value.search(/\s+—\s+/);
  if (dashIdx !== -1) {
    note = value.slice(dashIdx).replace(/^\s+—\s+/, '').trim();
    value = value.slice(0, dashIdx).trim();
  }
  const labelOk = label && label.length <= 24 && label.split(/\s+/).length <= 2 && !label.includes(',');
  const valueOk = value.length > 0 && value.length <= 48 && !/[.!?,;]/.test(value);
  if (!labelOk || !valueOk) return null;
  return { type: label, name: value, note };
}

// Разбирает ВСЮ секцию «Ключевые локации» на { narrative, records } — narrative
// (свободный текст) не теряется, нужен обратной записи для точечной правки
// ОДНОЙ записи с сохранением остального текста секции.
function splitLocationSection(text) {
  const lines = String(text || '').split('\n').map(l => l.replace(/^\s*-\s?/, '').trim()).filter(Boolean);
  const narrative = [], records = [];
  for (const line of lines) {
    const rec = parseLocationLine(line);
    if (rec) records.push(rec); else narrative.push(line);
  }
  return { narrative: narrative.join('\n'), records };
}

// Обратная сериализация — тот же формат, что _locationRowToLine на клиенте
// (public/scripts/city.js), нужна серверу для точечной обратной записи, где
// нет клиента, который бы это сделал сам.
function serializeLocationSection(narrative, records) {
  const narrativeLines = narrative ? narrative.split('\n').map(l => l.trim()).filter(Boolean) : [];
  const recordLines = records.map(r => {
    const base = r.type ? `${r.type}: ${r.name}` : r.name;
    const note = r.note ? String(r.note).trim().replace(/—/g, '–') : '';
    return note ? `${base} — ${note}` : base;
  });
  return [...narrativeLines, ...recordLines].join('\n');
}

// Совпадение имени локации с записью — не только точным именем, но и по
// части ЗАГОЛОВКА локации до первого « — » (карточки вроде «Опера Гарнье —
// Главный Элизиум, 9-й округ», где «хвост» исторически вписан в H1, см.
// техспеку location-card-actions §7.1, фикс _locNameKnown на клиенте — это
// его серверный эквивалент: список записей вместо булева результата).
function findRecordIndexForLocation(records, locTitle) {
  let idx = records.findIndex(r => r.name === locTitle);
  if (idx !== -1) return idx;
  const shortTitle = String(locTitle || '').split(/\s+—\s+/)[0].trim();
  if (!shortTitle) return -1;
  return records.findIndex(r => r.name === shortTitle);
}

// «Тип» → куда его писать на карточке САМОЙ локации. Значение — чистый тип,
// без маркера/заметки (2026-08-06 — заметка теперь живёт только в city.md).
const SIGNIFICANT_PLACE_TYPES = Object.fromEntries(
  CITY_LOCATION_TYPES.map(type => [type, { field: 'locStatus', value: type }])
);

module.exports = {
  CITY_LOCATION_TYPES, SIGNIFICANT_PLACE_TYPES,
  parseLocationLine, splitLocationSection, serializeLocationSection,
  findRecordIndexForLocation,
};
