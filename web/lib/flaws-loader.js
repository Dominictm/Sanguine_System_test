// Loader for flaws library (физические, умственные, социальные, сверхъестественные)
// Mirrors patterns from merits-loader.js

const fs = require('fs');
const path = require('path');

let flawsByCategory = {};

function loadFlaws(category) {
  if (flawsByCategory[category]) {
    return flawsByCategory[category];
  }

  try {
    const filePath = path.join(__dirname, `../../system/library/flaws/${category}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    flawsByCategory[category] = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`Failed to load flaws/${category}.json:`, e.message);
    flawsByCategory[category] = [];
  }

  return flawsByCategory[category];
}

function getFlaws(category) {
  return loadFlaws(category);
}

function getAllFlaws() {
  // Load all available categories
  const categories = ['физические', 'умственные', 'социальные', 'сверхъестественные'];
  const all = {};
  categories.forEach(cat => {
    all[cat] = loadFlaws(cat);
  });
  return all;
}

// Сбросить кэш категории после записи в её JSON-файл (см. merits-loader.js).
function invalidateFlaws(category) {
  delete flawsByCategory[category];
}

module.exports = { getFlaws, getAllFlaws, invalidateFlaws };
