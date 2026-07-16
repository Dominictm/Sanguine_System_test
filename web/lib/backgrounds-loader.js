// Loader for backgrounds library (general, vampire, ghoul, mage, changeling)
// Mirrors patterns from merits-loader.js / disciplines-loader.js

const fs = require('fs');
const path = require('path');

let backgroundsByCategory = {};

function loadBackgrounds(category) {
  if (backgroundsByCategory[category]) {
    return backgroundsByCategory[category];
  }

  try {
    const filePath = path.join(__dirname, `../../system/library/backgrounds/${category}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    backgroundsByCategory[category] = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`Failed to load backgrounds/${category}.json:`, e.message);
    backgroundsByCategory[category] = [];
  }

  return backgroundsByCategory[category];
}

function getBackgrounds(category) {
  return loadBackgrounds(category);
}

function getAllBackgrounds() {
  // Load all available categories
  const categories = ['general', 'vampire', 'ghoul', 'mage', 'changeling'];
  const all = {};
  categories.forEach(cat => {
    all[cat] = loadBackgrounds(cat);
  });
  return all;
}

// Сбросить кэш категории после записи в её JSON-файл (см. merits-loader.js).
function invalidateBackgrounds(category) {
  delete backgroundsByCategory[category];
}

module.exports = { getBackgrounds, getAllBackgrounds, invalidateBackgrounds };
