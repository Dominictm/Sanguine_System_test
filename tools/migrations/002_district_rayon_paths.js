'use strict';
// Убирает уровень «Округ» (district_NN) из адресации локаций — план
// 2026-08-02-city-creation-restructure-spec.md §8. Итоговая иерархия — ровно
// два уровня вложенности: cities/<city>/locations/<rayon-slug>/<loc-slug>/<loc-slug>.md.
//
// Что делает (на реальных данных cities/paris и cities/balmont, проверено вручную
// перед написанием — find cities -path "*/locations/*" -type d):
//
// 1) locations/district_NN/<rayon>/<loc>/… (основной парижский паттерн, ~20 связок:
//    district_01/luvr/il_de_la_site и т.п.) — папка <rayon> со всем содержимым
//    переносится на уровень выше (district_NN/<rayon> → <rayon>), сам district_NN
//    удаляется, если опустел.
//
// 2) locations/district_NN/<loc>/<loc>.md (Balmont: district_01/podzemnyy_dok —
//    округ есть, а района нет вообще, <loc> — сразу карточка) — «сирота» без
//    промежуточного района: район назначается по образцу уже существующего
//    cities/paris/locations/la_defans_bd/la_defans_bd/la_defans_bd.md (район = сама
//    локация), т.е. district_01/podzemnyy_dok/podzemnyy_dok.md → podzemnyy_dok/podzemnyy_dok/podzemnyy_dok.md.
//
// 3) locations/<loc>.md напрямую под locations/ без округа и без района вообще
//    (Paris: orli_yug/aeroport_orli_yug.md — сама локация 1-уровневая, файл
//    называется иначе, чем содержащая её папка) — тот же приём «сирота»:
//    район = имя папки, локация = собственный слаг файла (не переименовываем
//    содержимое/файл, только оборачиваем его в папку-локацию его собственного
//    имени): orli_yug/aeroport_orli_yug.md → orli_yug/aeroport_orli_yug/aeroport_orli_yug.md.
//
// 4) Уже двухуровневые записи без округа (Paris: la_defans_bd/la_defans_bd,
//    metro_podzemnyy/stantsiya_prizrak_metro; Balmont: Другие/…, Ценр/…) — НЕ трогаем,
//    уже в целевом формате (в т.ч. кириллица «Другие»/«Ценр» — переслаговка вне
//    скоупа этой миграции).
//
// После переноса правит markdown-ссылки на переехавшие пути ВНУТРИ ТОГО ЖЕ города
// (archive/*.md, chronicles/**/*.md, характерных «[Текст](../locations/district_NN/…)»)
// — иначе validate_links.ps1 после миграции покажет битые ссылки.
//
// Идемпотентна: на уже мигрированных данных district_NN-папок и «сирот» не остаётся →
// { changed: 0 }.

const fs = require('fs'), path = require('path');
const { DISTRICT_FILENAME } = require('../../web/lib/parsers/district');
const { updateMdLinks } = require('../../web/lib/md_links');

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isDirEmpty(dir) { try { return fs.readdirSync(dir).length === 0; } catch { return true; } }
function relPosix(root, p) { return path.relative(root, p).split(path.sep).join('/'); }

// Возвращает список подпапок (без файлов), исключая служебные (.gitkeep-родители пустые и т.п. — тут не фильтруем спец-файлы, только каталоги).
function subdirs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
}
// district.md — метаданные РАЙОНА (миграция 003), не карточка локации: исключаем его
// из «прямого .md» при определении «сирота ли эта папка» — иначе уже смигрированный
// район (rayon/district.md + rayon/<loc>/<loc>.md) на повторном прогоне сам себя
// принимает за «сироту» и заворачивает district.md вместе со всеми локациями внутрь
// несуществующей папки «district» — ломает идемпотентность (было обнаружено вручную
// при повторном прогоне до релиза этой миграции).
function hasDirectMd(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .some(e => e.isFile() && e.name.endsWith('.md') && e.name !== DISTRICT_FILENAME);
}

// «Сирота»: папка dirPath напрямую содержит один .md (карточку локации) — оборачивает
// его в собственную подпапку-локацию (имя = базовое имя .md файла), под rayonSlug
// (папка dirPath после этого либо становится самим районом — если rayonSlug === её
// текущее имя и она осталась на месте, — либо пустеет и удаляется, если это была
// district_NN/<rayonSlug>, перенесённая на новое место).
// @returns {{changed: 0|1, newRel: string|null}} newRel — «<rayonSlug>/<locSlug>» относительно
//   locRoot, для карты переименований (починка ссылок); null, если ничего не менялось.
function wrapOrphan(locRoot, dirPath, rayonSlug, log) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  // district.md (если уже есть — не должно на практике встретиться раньше 003, но
  // защищаемся на случай ручного/частичного прогона) остаётся на месте района,
  // не участвует в определении «сироты» и не переносится вместе с локацией.
  const movable = entries.filter(e => e.name !== DISTRICT_FILENAME);
  const mdFiles = movable.filter(e => e.isFile() && e.name.endsWith('.md'));
  if (mdFiles.length !== 1) {
    log(`ПРОПУЩЕНО (сирота): ${relPosix(locRoot, dirPath)} — ожидался 1 .md файл, найдено ${mdFiles.length}`);
    return { changed: 0, newRel: null };
  }
  const locSlug = mdFiles[0].name.replace(/\.md$/, '');
  const destRayon = path.join(locRoot, rayonSlug);
  const destLoc = path.join(destRayon, locSlug);
  if (fs.existsSync(destLoc)) {
    log(`ПРОПУЩЕНО (сирота): ${relPosix(locRoot, dirPath)} — целевой путь ${relPosix(locRoot, destLoc)} уже существует`);
    return { changed: 0, newRel: null };
  }
  fs.mkdirSync(destLoc, { recursive: true });
  for (const e of movable) {
    fs.renameSync(path.join(dirPath, e.name), path.join(destLoc, e.name));
  }
  if (dirPath !== destRayon && isDirEmpty(dirPath)) fs.rmdirSync(dirPath);
  log(`перенесено (сирота): ${relPosix(locRoot, dirPath)} → ${relPosix(locRoot, destLoc)}`);
  return { changed: 1, newRel: `${rayonSlug}/${locSlug}` };
}

// Обходит locations/ одного города, переносит district_NN/* на верхний уровень и
// оборачивает «сирот». renameMap собирает {oldRel,newRel} (относительно locRoot,
// POSIX-слэши) для последующей починки markdown-ссылок.
function migrateLocationsTree(locRoot, renameMap, log) {
  let changed = 0;
  if (!fs.existsSync(locRoot)) return changed;

  for (const name of subdirs(locRoot)) {
    const entryPath = path.join(locRoot, name);

    if (/^district_\d+$/i.test(name)) {
      for (const childName of subdirs(entryPath)) {
        const childPath = path.join(entryPath, childName);
        const oldRel = relPosix(locRoot, childPath);
        if (hasDirectMd(childPath)) {
          // «Сирота» под округом (Balmont: district_01/podzemnyy_dok) — район = она сама.
          const r = wrapOrphan(locRoot, childPath, childName, log);
          changed += r.changed;
          if (r.newRel) renameMap.push({ oldRel, newRel: r.newRel });
        } else {
          // Полноценный район (округ/район/локация…) — переносим целиком на верхний уровень.
          const destBase = path.join(locRoot, childName);
          if (fs.existsSync(destBase)) {
            log(`ПРОПУЩЕНО: ${oldRel} — целевой путь ${relPosix(locRoot, destBase)} уже существует (конфликт имён)`);
            continue;
          }
          fs.renameSync(childPath, destBase);
          renameMap.push({ oldRel, newRel: childName });
          changed++;
          log(`перенесено: ${oldRel} → ${childName}`);
        }
      }
      if (isDirEmpty(entryPath)) { fs.rmdirSync(entryPath); log(`удалена пустая ${relPosix(locRoot, entryPath)}`); }
    } else if (hasDirectMd(entryPath)) {
      // «Сирота» напрямую под locations/ без округа (Paris: orli_yug/aeroport_orli_yug.md).
      const r = wrapOrphan(locRoot, entryPath, name, log);
      changed += r.changed;
      if (r.newRel) renameMap.push({ oldRel: name, newRel: r.newRel });
    }
    // иначе — уже двухуровневая запись (рayон с локациями внутри), не трогаем.
  }
  return changed;
}

// Правит markdown-ссылки вида "...locations/<oldRel>/..." на "...locations/<newRel>/..."
// во всех .md файлах города (любая глубина «../»). Возвращает число изменённых файлов.
// Реализация вынесена в web/lib/md_links.js (§B1) — тот же обход теперь нужен и
// одиночному переносу локации из PUT /api/locations/:slug/district, дублировать нельзя.
function fixLinks(cityDir, renameMap, log) {
  return updateMdLinks(cityDir, renameMap, { prefix: 'locations', log }).filesChanged;
}

// Правит ИСХОДЯЩИЕ относительные ссылки (вида «../../characters/…», «../../../chronicles/…»)
// ВНУТРИ самих перенесённых карточек локаций. fixLinks() выше чинит только ссылки,
// буквально повторяющие «locations/<путь>» (входящие — из archive/chronicles СНАРУЖИ
// locations/), но глубина вложенности перенесённого файла тоже могла измениться
// (district_NN исчез — на 1 уровень МЕНЬШЕ; «сирота» обёрнута в свою папку — на 1
// уровень БОЛЬШЕ), а такие ссылки просто повторяют нужное число «../» без явного
// упоминания «locations/» — фикс через substring их не видит вообще.
//
// Для каждого {oldRel,newRel} из renameMap резолвит ссылку от СТАРОГО расположения
// файла (oldRel — ещё существующий на диске путь до переноса) — если попадает
// ВНУТРЬ того же перенесённого поддерева, ссылка не трогается (весь каталог
// переехал как единое целое, взаимное расположение файлов внутри не изменилось).
// Если цель СНАРУЖИ — пересчитывает свежий относительный путь от НОВОГО расположения
// к той же самой (уже существующей!) абсолютной цели — не подбор количества «../»,
// а честный path.relative(), поэтому корректен для любой комбинации переносов.
function fixOutgoingLinks(locRoot, renameMap, log) {
  let filesChanged = 0;
  const LINK_RE = /\]\(((?:\.\.\/)+[^)]*)\)/g;

  for (const { oldRel, newRel } of renameMap) {
    const oldSubtreeRoot = path.join(locRoot, ...oldRel.split('/'));
    const newSubtreeRoot = path.join(locRoot, ...newRel.split('/'));
    if (!fs.existsSync(newSubtreeRoot)) continue;

    function fixFile(fp) {
      const relFromNewRoot = path.relative(newSubtreeRoot, fp);
      const oldFileDir = path.dirname(path.join(oldSubtreeRoot, relFromNewRoot));
      const newFileDir = path.dirname(fp);
      const raw = fs.readFileSync(fp, 'utf8');
      const bom = raw.charCodeAt(0) === 0xFEFF;
      const text = bom ? raw.slice(1) : raw;
      let touched = false;
      const fixed = text.replace(LINK_RE, (whole, target) => {
        const oldAbs = path.resolve(oldFileDir, target);
        if (oldAbs === oldSubtreeRoot || oldAbs.startsWith(oldSubtreeRoot + path.sep)) return whole;
        const newTargetRel = path.relative(newFileDir, oldAbs).split(path.sep).join('/');
        if (newTargetRel === target) return whole;
        touched = true;
        return `](${newTargetRel})`;
      });
      if (touched) {
        fs.writeFileSync(fp, (bom ? '﻿' : '') + fixed, 'utf8');
        filesChanged++;
        log(`исходящие ссылки поправлены: ${relPosix(locRoot, fp)}`);
      }
    }

    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.isFile() && e.name.endsWith('.md')) fixFile(fp);
      }
    })(newSubtreeRoot);
  }
  return filesChanged;
}

module.exports = {
  description: 'убрать уровень «Округ» (district_NN) из locations/ — Город → Район → Локация (2026-08-02, §8)',
  migrateFs({ cityDir, log }) {
    const locRoot = path.join(cityDir, 'locations');
    const renameMap = [];
    let changed = migrateLocationsTree(locRoot, renameMap, log);
    changed += fixLinks(cityDir, renameMap, log);
    changed += fixOutgoingLinks(locRoot, renameMap, log);
    return { changed };
  },
};
