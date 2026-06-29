# Города (домены)

Здесь живут города-домены проекта — по папке на каждый: `cities/<slug>/`.

**В релизной (тестовой) версии городов нет** — она передаётся Рассказчику чистой;
сборка релиза автоматически вычищает содержимое `cities/*/` (см. `tools/build_release.js`).
Создай свой первый домен любым из способов:

- **Веб-интерфейс:** страница «Города» → кнопка «+» (создать домен).
- **CLI:** `node tools/new_city.js <slug> "<Название>" <год>`

Структура одного города (создаётся автоматически):

```
cities/<slug>/
  city.md                  — сеттинг: политика, локации, лейтмотивы, специфика
  archive/                 — political_state.md, events.md, characters_index.md, visitors.md …
  characters/<линейка>/    — vampires, fairies, mortals, werewolves, mages, hunters
  chronicles/<хроника>/    — chronicle.md, events.md, modules/<модуль>/ …
  locations/district_NN/   — карточки локаций
```

Подробности структуры и правила — в [`CLAUDE.md`](../CLAUDE.md) и [`system/rules/`](../system/rules/).
