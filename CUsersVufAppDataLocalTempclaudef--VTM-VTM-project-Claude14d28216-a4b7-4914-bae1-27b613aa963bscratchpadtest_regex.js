// Test keyPoints regex against different card formats

const regex = /(## (?:🗺️\s+)?Ключевые точки[^\n]*\n+)([\s\S]+?)(\n## |\n---|$)/i;

// Test 1: Normal case with another section below
const test1 = `## 🗺️ Ключевые точки
| Место | Описание |
|---|---|
| Стол | Деревянный стол |
---
## 🪝 Сценарные крючки`;

// Test 2: End of file (no section after)
const test2 = `## 🗺️ Ключевые точки
| Место | Описание |
|---|---|
| Стол | Деревянный стол |`;

// Test 3: Without emoji
const test3 = `## Ключевые точки
| Место | Описание |
|---|---|
| Стол | Деревянный стол |
---
## 🪝 Сценарные крючки`;

// Test 4: Multi-line content
const test4 = `## 🗺️ Ключевые точки
| Место | Описание |
|---|---|
| Стол | Деревянный стол |
| Дверь | Красная дверь |
---
## 🪝 Сценарные крючки`;

console.log('Test 1 (normal):', regex.test(test1) ? 'PASS' : 'FAIL');
const m1 = regex.exec(test1);
console.log('  Captured:', m1 ? [m1[1].slice(0,30), m1[2].slice(0,30), m1[3].slice(0,30)] : 'NO MATCH');

console.log('\nTest 2 (end of file):', regex.test(test2) ? 'PASS' : 'FAIL');
const m2 = regex.exec(test2);
console.log('  Captured:', m2 ? [m2[1].slice(0,30), m2[2].slice(0,30), m2[3]] : 'NO MATCH');

console.log('\nTest 3 (no emoji):', regex.test(test3) ? 'PASS' : 'FAIL');
const m3 = regex.exec(test3);
console.log('  Captured:', m3 ? [m3[1].slice(0,30), m3[2].slice(0,30), m3[3].slice(0,30)] : 'NO MATCH');

console.log('\nTest 4 (multi-line):', regex.test(test4) ? 'PASS' : 'FAIL');
const m4 = regex.exec(test4);
console.log('  Captured:', m4 ? [m4[1].slice(0,30), m4[2].slice(0,30), m4[3].slice(0,30)] : 'NO MATCH');

// Test replacement logic
console.log('\n=== REPLACEMENT TESTS ===');
const value = '| Новое | Место |';

const replaced1 = test1.replace(regex, (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`);
console.log('Test 1 replaced (expects value before ---):\n', replaced1);

const replaced2 = test2.replace(regex, (_, hdr, _old, tail) => `${hdr}${value}\n${tail}`);
console.log('\nTest 2 replaced (expects value at end):\n', replaced2);
