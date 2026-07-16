// Loader for merits library (physical, social, mental, supernatural)
// Mirrors patterns from disciplines-loader.js

const fs = require('fs');
const path = require('path');

let meritsByCategory = {};

function loadMerits(category) {
  if (meritsByCategory[category]) {
    return meritsByCategory[category];
  }

  try {
    const filePath = path.join(__dirname, `../../system/library/merits/${category}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    meritsByCategory[category] = Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`Failed to load merits/${category}.json:`, e.message);
    meritsByCategory[category] = [];
  }

  return meritsByCategory[category];
}

function getMerits(category) {
  return loadMerits(category);
}

function getAllMerits() {
  // Load all available categories
  const categories = ['physical', 'social', 'mental', 'supernatural'];
  const all = {};
  categories.forEach(cat => {
    all[cat] = loadMerits(cat);
  });
  return all;
}

// Сбросить кэш категории после записи в её JSON-файл (создание/правка/удаление
// авторского достоинства) — без этого следующий getMerits(category) молча
// вернёт старый массив из памяти до перезапуска сервера.
function invalidateMerits(category) {
  delete meritsByCategory[category];
}

module.exports = { getMerits, getAllMerits, invalidateMerits };
