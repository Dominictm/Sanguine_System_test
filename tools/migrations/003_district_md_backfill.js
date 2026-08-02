'use strict';
// Бэкофилл district.md — план 2026-08-02-city-creation-restructure-spec.md §5.1.
// После 002_district_rayon_paths.js (СТРОГО после — этот файл на номер больше,
// иначе бэкофилл создаст district.md по ещё не мигрированным путям) каждая папка
// района (locations/<rayon-slug>/, содержащая хотя бы одну вложенную папку-локацию
// со своим <slug>.md) должна иметь рядом district.md с метаданными района. Там, где
// его ещё нет — создаём с плейсхолдерами ⚠️ (Тип района, Влияние — Секта/Клан,
// Описание); Название берём из имени папки района (человекочитаемо восстановить
// точное историческое название по одному только слагу нельзя — тоже плейсхолдер
// формата «⚠️ <slug>», чтобы не выдумывать факт, см. CLAUDE.md «Канонные факты»).
//
// Тот же buildDistrictMd, что и POST /api/cities/:slug/districts и tools/new_district.js
// (web/lib/parsers/district.js) — единый источник шаблона.
//
// Идемпотентна: рayон с уже существующим district.md пропускается → { changed: 0 }
// на повторном прогоне.

const fs = require('fs'), path = require('path');
const { buildDistrictMd, DISTRICT_FILENAME } = require('../../web/lib/parsers/district');

function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); }
  catch { return []; }
}
// district.md — метаданные самого района, не карточка локации — исключаем его при
// проверке «есть ли здесь СВОЙ .md напрямую» (иначе уже мигрированный/бэкофилленный
// район на повторном прогоне перестаёт опознаваться как rayon-папка).
function hasDirectMd(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .some(e => e.isFile() && e.name.endsWith('.md') && e.name !== DISTRICT_FILENAME);
}
// Район = папка НЕ содержащая свой .md напрямую (значит внутри — вложенные
// папки-локации со своими <slug>.md), т.е. уже приведена к целевой форме
// «Город → Район → Локация» (после 002 иначе и не бывает).
function isRayonDir(dir) {
  return subdirs(dir).length > 0 && !hasDirectMd(dir);
}

module.exports = {
  description: 'бэкофилл district.md с плейсхолдерами для папок районов, где его ещё нет (2026-08-02, §5.1)',
  migrateFs({ cityDir, log }) {
    const locRoot = path.join(cityDir, 'locations');
    let changed = 0;
    if (!fs.existsSync(locRoot)) return { changed };

    for (const rayonSlug of subdirs(locRoot)) {
      const rayonDir = path.join(locRoot, rayonSlug);
      if (!isRayonDir(rayonDir)) continue; // «сирота»/непонятная запись — 002 должен был её уже разобрать
      const districtPath = path.join(rayonDir, DISTRICT_FILENAME);
      if (fs.existsSync(districtPath)) continue;

      const md = buildDistrictMd({ name: `⚠️ ${rayonSlug}` });
      fs.writeFileSync(districtPath, md, 'utf8');
      changed++;
      log(`district.md создан: locations/${rayonSlug}/${DISTRICT_FILENAME}`);
    }
    return { changed };
  },
};
