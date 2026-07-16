# Промты для генерации фоновых иллюстраций разделов

Сгенерируйте изображения (любым GPT-image/DALL-E инструментом) и сохраните
каждое **строго под указанным именем** в:

```
web/public/img/backgrounds/<имя>.png
```

Пункты 1–14 уже сгенерированы и подключены. **Новые — пункты 15–18**
(`session`, `city`, `city-new`, `audio-library`) — разделы, которые появились
позже и остались без фона; их и нужно сгенерировать.

Рекомендуемые параметры генерации (единые для всей серии, включая новые 4,
чтобы иллюстрации смотрелись одной серией):

- Ориентация: широкая, альбомная (~1600×1000 или ближайшее доступное 16:10/3:2).
- Единая цветовая палитра по всей серии: приглушённый бордовый/багровый +
  почти чёрный (сайт использует `#07050a`…`#181420`), тёплый акцент свечи/
  фонаря — как единственный тёплый цвет в кадре.
- Без текста, без букв, без логотипов, без интерфейсных элементов на картинке.
- Тёмная атмосфера, готический/нуарный Париж 2010 (сеттинг VTM), не мультяшно.
- Центральная/лево-центральная часть кадра должна быть чуть менее плотной
  (не забита деталями до краёв) — поверх картинки ляжет текст интерфейса, и
  тёмный градиент-затемнение (сайт добавит это сам через CSS), так что
  композиция может быть смелее по краям и спокойнее в центре.
- Вес файла: по возможности не больше ~1-2 МБ на изображение (не критично для
  корректности, но лучше для скорости загрузки страницы).

После того как файлы появятся в `web/public/img/backgrounds/`, сообщите — я
добавлю по одной CSS-строке на каждый новый раздел в `web/public/styles.css`
(формат уже задокументирован в комментарии над блоком `.page.active`) и
проверю все разделы в браузере.

---

## 1. `dashboard.png` — Панель

> Atmospheric dark gothic illustration for a vampire chronicle dashboard.
> A moody noir Paris rooftop view at night — dense huddled mansard roofs and
> narrow chimneys stretching to the horizon, no famous landmarks or
> recognizable monuments, muted crimson and near-black palette, faint
> candlelight glow on the horizon, no text, no UI elements, painterly digital
> art, wide landscape composition, darker toward the edges, calmer in the
> center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 2. `chronicle.png` — Хронология

> Atmospheric dark gothic illustration symbolizing a timeline of vampire
> chronicle events — an ornate antique clock face or hourglass half-dissolved
> into drifting fog, muted crimson and near-black palette, no text, no UI
> elements, painterly digital art, wide landscape composition, darker toward
> the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 3. `characters.png` — Персонажи

> Atmospheric dark gothic illustration symbolizing vampire characters — an
> ornate empty portrait frame or a veiled silhouette lit by a single candle,
> muted crimson and near-black palette, no visible detailed faces, no text,
> no UI elements, painterly digital art, wide landscape composition, darker
> toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 4. `graph.png` — Связи

> Atmospheric dark gothic illustration of an intricate web of crimson threads
> or a spider web connecting faint glowing nodes in darkness, symbolizing a
> network of relationships, muted crimson and near-black palette, no text, no
> UI elements, painterly digital art, wide landscape composition, darker
> toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 5. `factions.png` — Фракции

> Atmospheric dark gothic illustration symbolizing vampire political
> factions — heraldic banners or clan sigils half-hidden in shadow and fog,
> muted crimson and near-black palette, no text, no UI elements, painterly
> digital art, wide landscape composition, darker toward the edges, calmer
> in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 6. `chronicles-page.png` — Хроники

> Atmospheric dark gothic illustration symbolizing a collection of story
> chronicles — a stack of old leather-bound journals with a wax seal, dim
> candlelight, muted crimson and near-black palette, no text, no UI elements,
> painterly digital art, wide landscape composition, darker toward the edges,
> calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 7. `modules.png` — Модули

> Atmospheric dark gothic illustration symbolizing modular story sessions —
> scattered tarot-like cards or puzzle fragments arranged on a dark table,
> muted crimson and near-black palette, no text, no UI elements, painterly
> digital art, wide landscape composition, darker toward the edges, calmer
> in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 8. `threads.png` — Нити

> Atmospheric dark gothic illustration symbolizing unresolved plot threads —
> tangled crimson thread or string unspooling into darkness, muted crimson
> and near-black palette, no text, no UI elements, painterly digital art,
> wide landscape composition, darker toward the edges, calmer in the
> center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 9. `rumors.png` — Слухи

> Atmospheric dark gothic illustration symbolizing whispered rumors — faint
> overlapping silhouettes whispering in a foggy Paris alley at night, muted
> crimson and near-black palette, no text, no UI elements, painterly digital
> art, wide landscape composition, darker toward the edges, calmer in the
> center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 10. `locations.png` — Локации

> Atmospheric dark gothic illustration of a moody Paris street or park path
> at night, wrought-iron lamppost, wet cobblestones, muted crimson and
> near-black palette, no text, no UI elements, painterly digital art, wide
> landscape composition, darker toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 11. `library.png` — Библиотека

> Atmospheric dark gothic illustration of an ancient occult library — tall
> bookshelves disappearing into shadow, an open grimoire on a desk,
> candlelight, muted crimson and near-black palette, no text, no UI elements,
> painterly digital art, wide landscape composition, darker toward the edges,
> calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 12. `tools.png` — Инструменты

> Atmospheric dark gothic illustration symbolizing a storyteller's tools —
> an antique quill, ink well, wax seal and blank parchment on a dark desk,
> muted crimson and near-black palette, no text, no UI elements, painterly
> digital art, wide landscape composition, darker toward the edges, calmer
> in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 13. `search.png` — Поиск

> Atmospheric dark gothic illustration symbolizing a search through
> darkness — a single lantern or magnifying glass casting light into deep
> fog, muted crimson and near-black palette, no text, no UI elements,
> painterly digital art, wide landscape composition, darker toward the edges,
> calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 14. `module.png` — Просмотр модуля (детальная страница)

> Atmospheric dark gothic illustration symbolizing a single story module in
> progress — an open leather journal or dossier with loose pages and a red
> wax seal, a lit candle beside it on a dark writing desk, muted crimson and
> near-black palette, no text, no UI elements, painterly digital art, wide
> landscape composition, darker toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 15. `session.png` — Сессия (режим живой игры)

> Atmospheric dark gothic illustration symbolizing a live storytelling
> session in progress — a Storyteller's dark tabletop seen from above, dice
> mid-roll, scattered character sheets and a lit taper candle casting long
> shadows, muted crimson and near-black palette, no readable text on the
> sheets, no UI elements, painterly digital art, wide landscape composition,
> darker toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 16. `city.png` — Город (страница одного домена)

> Atmospheric dark gothic illustration symbolizing a single vampire domain —
> an antique hand-drawn city map half-unrolled on a dark desk, its edges
> curling into shadow, a wax seal and a lit candle beside it, no readable
> street names or labels, muted crimson and near-black palette, no text, no
> UI elements, painterly digital art, wide landscape composition, darker
> toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 17. `city-new.png` — Города (выбор домена)

> Atmospheric dark gothic illustration symbolizing a choice between several
> vampire domains — a handful of rolled parchment scrolls and wax-sealed
> city charters fanned out across a dark table, each a different unnamed
> domain, dim candlelight, muted crimson and near-black palette, no
> readable text on the scrolls, no UI elements, painterly digital art, wide
> landscape composition, darker toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.

## 18. `audio-library.png` — Звуковая библиотека (саундборд сессии)

> Atmospheric dark gothic illustration symbolizing an ambient soundboard for
> a storytelling session — an antique brass gramophone horn in candlelight,
> faint visible sound waves dissolving into drifting fog, muted crimson and
> near-black palette, no text, no UI elements, painterly digital art, wide
> landscape composition, darker toward the edges, calmer in the center-left.
>
> Technical: 16:10 landscape (~1600x1000px), no text, no watermark, no logo,
> no UI elements, consistent muted crimson/near-black palette matching the
> rest of the series.
