# Справочник дисциплин V20

> Содержимое перенесено в `system/library/disciplines/` — по одному MD-файлу на дисциплину.
> Канонический источник для сервера, веба и Рассказчика — **`system/library/disciplines/`**.

Полная библиотека (17 дисциплин, уровни 1–10, «Литературное описание» + «Система» по каждой силе):

- `system/library/disciplines/animalism.md` — Анимализм
- `system/library/disciplines/auspex.md` — Прорицание
- `system/library/disciplines/celerity.md` — Стремительность
- `system/library/disciplines/chimerstry.md` — Химерия
- `system/library/disciplines/dementation.md` — Дементация
- `system/library/disciplines/dominate.md` — Доминирование
- `system/library/disciplines/fortitude.md` — Стойкость
- `system/library/disciplines/necromancy.md` — Некромантия (пути)
- `system/library/disciplines/obfuscate.md` — Скрытность
- `system/library/disciplines/obtenebration.md` — Власть над Тенью
- `system/library/disciplines/potence.md` — Могущество
- `system/library/disciplines/presence.md` — Присутствие
- `system/library/disciplines/protean.md` — Протеанство
- `system/library/disciplines/quietus.md` — Квиетус
- `system/library/disciplines/serpentis.md` — Серпентис
- `system/library/disciplines/thaumaturgy.md` — Тауматургия (пути)
- `system/library/disciplines/vicissitude.md` — Висситюд

Веб-интерфейс: «Библиотека» → «Дисциплины» — список + детальный вид с красно-золотыми точками уровня.
API: `GET /api/library/disciplines` — массив всех дисциплин (сервер парсит `system/library/disciplines/*.md`).
