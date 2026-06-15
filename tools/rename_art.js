#!/usr/bin/env node
/**
 * Переименовывает арт-файлы персонажей в slug_01.ext, slug_02.ext, ...
 * и обновляет секцию ## 🖼️ Изображения в карточке персонажа.
 *
 * Использование:
 *   node tools/rename_art.js                        — все города, все персонажи
 *   node tools/rename_art.js paris                  — все персонажи Парижа
 *   node tools/rename_art.js paris ganesh           — только ganesh в Париже
 *   node tools/rename_art.js paris vampires ganesh  — уточнить линейку явно
 */

const fs   = require('fs').promises;
const path = require('path');

const ROOT      = path.join(__dirname, '..');
const CITIES    = path.join(ROOT, 'cities');
const LINEAGES  = ['vampires', 'fairies', 'mortals', 'werewolves', 'mages', 'hunters'];
const IMG_RE    = /\.(jpg|jpeg|png|webp|gif)$/i;

async function isDir(p) {
  const s = await fs.stat(p).catch(() => null);
  return !!s?.isDirectory();
}

async function renameCharArt(charDir, slug, dryRun) {
  const artDir = path.join(charDir, 'art');
  if (!(await isDir(artDir))) return 0;

  const all   = await fs.readdir(artDir).catch(() => []);
  const files = all.filter(f => IMG_RE.test(f)).sort();
  if (!files.length) return 0;

  // Build target names: slug_01.ext, slug_02.ext, ...
  const targets = files.map((f, i) => {
    const ext = f.split('.').pop().toLowerCase();
    return `${slug}_${String(i + 1).padStart(2, '0')}.${ext}`;
  });

  const alreadyOk = files.every((f, i) => f === targets[i]);
  if (alreadyOk) return 0;

  console.log(`  ${slug}:`);
  files.forEach((f, i) => {
    if (f !== targets[i]) console.log(`    ${f}  →  ${targets[i]}`);
  });

  if (dryRun) return files.length;

  // Rename via temp names to avoid collisions (e.g. A→B when B already exists as A)
  const temps = files.map((_, i) => `__rename_tmp_${i}__`);
  for (let i = 0; i < files.length; i++) {
    await fs.rename(path.join(artDir, files[i]), path.join(artDir, temps[i]));
  }
  for (let i = 0; i < temps.length; i++) {
    await fs.rename(path.join(artDir, temps[i]), path.join(artDir, targets[i]));
  }

  // Update ## 🖼️ Изображения section in the card
  const cardPath = path.join(charDir, `${slug}.md`);
  let card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
  if (card) {
    const newSection =
      `## 🖼️ Изображения\n\n` +
      targets.map((name, i) => `- [Образ ${i + 1}](art/${name})`).join('\n') +
      '\n';
    // Replace everything from ## 🖼️ Изображения to next ## or end of file
    if (card.includes('## 🖼️ Изображения')) {
      card = card.replace(/## 🖼️ Изображения[\s\S]*?(?=\n##\s|\s*$)/, newSection);
    } else {
      card += `\n${newSection}`;
    }
    await fs.writeFile(cardPath, card, 'utf-8');
    console.log(`    ✓ карточка обновлена`);
  }

  return files.length;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const clean  = args.filter(a => !a.startsWith('-'));

  const [targetCity, targetLineageOrSlug, targetSlug] = clean;

  // Determine if second arg is a lineage or a slug
  const targetLineage = LINEAGES.includes(targetLineageOrSlug) ? targetLineageOrSlug : null;
  const slugArg       = targetSlug || (targetLineage ? null : targetLineageOrSlug) || null;

  if (dryRun) console.log('[Dry run — файлы не изменяются]\n');

  // List cities
  const allEntries = await fs.readdir(CITIES).catch(() => []);
  const cities = [];
  for (const e of allEntries) {
    if (targetCity && e !== targetCity) continue;
    if (await isDir(path.join(CITIES, e))) cities.push(e);
  }

  if (!cities.length) {
    console.error(`Город не найден: ${targetCity || '(любой)'}`);
    process.exit(1);
  }

  let total = 0;

  for (const city of cities) {
    const charsRoot = path.join(CITIES, city, 'characters');
    if (!(await isDir(charsRoot))) continue;

    const lineages = targetLineage ? [targetLineage] : LINEAGES;
    for (const lineage of lineages) {
      const lineageDir = path.join(charsRoot, lineage);
      if (!(await isDir(lineageDir))) continue;

      const slugs = await fs.readdir(lineageDir).catch(() => []);
      for (const slug of slugs) {
        if (slugArg && slug !== slugArg) continue;
        const charDir = path.join(lineageDir, slug);
        if (!(await isDir(charDir))) continue;
        total += await renameCharArt(charDir, slug, dryRun);
      }
    }
  }

  if (total === 0) {
    console.log('Все файлы уже названы правильно — ничего не изменено.');
  } else {
    console.log(`\nГотово. ${dryRun ? 'Будет переименовано' : 'Переименовано'}: ${total} файлов.`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
