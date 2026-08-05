# Библиотека кланов V20

Канонический источник справочника кланов: **по одному MD-файлу на клан**.
Сервер (`web/lib/clans.js` → `parseClanMd`) парсит эти файлы, отдаёт по
`GET /api/library/clans`, веб рендерит (вкладка «Сородичи» → «Кланы»).

В отличие от дисциплин/психических способностей клан — **не силовая
шкала**: одна запись, один блок «## Описание» в теле, без `## Уровень N`.

## Формат файла

```markdown
# 🧛 Тремер (Tremere)

- **Секта:** Камарилья
- **Дисциплины:** Аспект, Доминирование, Тауматургия
- **Слабость:** <текст>
- **Источник:** https://wod.su/vampire/clans/...

> (опц.) короткая цитата-эпиграф

## Описание

<основной текст — образ жизни, история, эстетика клана, своими словами>
```

Поля шапки:

- **Секта** — принадлежность клана (Камарилья / Шабаш / Независимые) —
  показывается бейджем прямо на карточке клана.
- **Дисциплины** — врождённые дисциплины клана, через запятую.
- **Слабость** — клановая слабость (Weakness) по V20.
- **Источник** — ссылка на статью, из которой адаптирован текст. Текст —
  добросовестный пересказ своими словами, не копипаста (та же конвенция,
  что у `disciplines/README.md`/`psychics/README.md`).

## Статус наполнения

Полный список с wod.su — 41 запись (2026-08-05): 7 базовых кланов corebook
V20 + все дополнительные записи разделов «Камарилья»/«Независимые»/«Шабаш»
индекса wod.su/vampire/clans.

| | |
|---|---|
| Камарилья (7 базовых кланов + 3 доп. записи) | `bruja.md`, `ventru.md`, `gangrel.md`, `malkavian.md`, `nosferatu.md`, `toreador.md`, `tremere.md`, `caitiff.md`, `gargoyles.md`, `lasombra-antitribu.md` |
| Независимые (13) | `assamite.md`, `baali.md`, `cappadocian.md`, `children-of-osiris.md`, `daughters-of-cacophony.md`, `followers-of-set.md`, `giovanni.md`, `nagaraja.md`, `old-clan-tzimisce.md`, `ravnos.md`, `salubri.md`, `samedi.md`, `true-brujah.md` |
| Шабаш (18) | `ahrimanes.md`, `assamite-antitribu.md`, `blood-brothers.md`, `brujah-antitribu.md`, `gangrel-antitribu.md`, `harbingers-of-skulls.md`, `kiasyd.md`, `lasombra.md`, `malkavian-antitribu.md`, `nosferatu-antitribu.md`, `panders.md`, `ravnos-antitribu.md`, `salubri-antitribu.md`, `serpents-of-the-light.md`, `toreador-antitribu.md`, `tremere-antitribu.md`, `tzimisce.md`, `ventrue-antitribu.md` |
| ⏸️ Отложено (не в этом цикле) | сект-варианты/бладлайны с wod.fandom.com сверх индекса wod.su (категория «Кланы» насчитывает до 174 записей — расширение отдельным запросом) |

Источники: [wod.su/vampire/clans](https://wod.su/vampire/clans) (индекс +
подстраницы отдельных кланов, разделы «Камарилья»/«Независимые»/«Шабаш»).
wod.fandom.com — тоже доступен (прямой HTTP-запрос с обычным `User-Agent`,
не через специализированные fetch-инструменты, которые могут получать `402`
на этом домене) — источник для будущего расширения сверх индекса wod.su.

> Примечание: `README.md` сервером пропускается (не клан).
