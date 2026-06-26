# Правила генерации промтов для изображений

## 🔒 Обязательные правила — применяются ко ВСЕМ промтам

| Правило | Требование |
|---|---|
| **Язык** | Промт пишется **исключительно на английском** — никакого русского текста в теле промта |
| **Без жестокости** | Никакой крови, ран, увечий, явного насилия — ни в промте, ни в описании внешности. Угроза и тёмная природа персонажа передаются через свет, тень, взгляд, позу |
| **Источник — персонаж** | Блок 1 строится на основе секции **`Внешность`** из карточки персонажа: цвет волос, глаз, кожи, одежда, поза — всё из текста карточки, не из головы |
| **Источник — локация** | Блок 1 строится на основе описания локации из карточки: архитектура, освещение, специфика места — только то, что указано в карточке |
| **Никаких обобщений** | Нельзя писать «vampire aristocrat» без конкретики: пол, облик, одежда, детали — обязаны совпадать с описанием в источнике |
| **Блочная структура** | Три блока (Персонаж/Место → Свет/Атмосфера → Стиль) — обязательны для всех промтов |
| **Негативный промт** | Всегда включать стандартный негативный промт (см. секцию ниже) |
| 🔒 **Фон персонажа — НЕ локация** | Для портретов персонажей (НПС/PC) фон в Блоке 2 — **абстрактный текстурный цветовой фон** (painterly color wash / smoke-like swirling brushstrokes, единый доминирующий оттенок), привязанный к цветовой идентичности персонажа (клановый акцент — см. «Ключ к этому стилю» и `CLAN_PROMPT_ACCENT`). **Запрещено**: конкретная архитектура, интерьеры, пейзажи, узнаваемые локации, фэнтезийные миры/города на фоне портрета — это разрушает единый стиль карточек. Для промтов **локаций** это правило не действует — там фон и есть сама локация (см. отдельный раздел) |

> ⚠️ Промт без опоры на карточку (внешность / описание локации) — **невалидный промт**. Перед написанием промта — прочитать карточку.

---

# Правила промтов для локаций

## Структура папок

**Локации в пределах города** (`<slug>` — ASCII-слаг):
```
cities/<город>/locations/district_NN/<район>/<локация>/<локация>.md
```

**Локации вне города** (другие места, внегородские события модуля):
```
cities/<город>/locations/Другие/<модуль>/<локация>/<локация>.md
```

> Пример: «Замок в Провансе» для модуля `proval_v_provanse` →
> `cities/paris/locations/Другие/proval_v_provanse/zamok_v_provanse/zamok_v_provanse.md`

Формат карточки — **одинаковый** для обоих случаев. Промт адаптируется под реальное место и время суток (если не ночь — указать явно).

---

## Эталонный стиль — задаётся городом

Визуальная идентичность локаций (палитра, освещение, архитектура, время суток) — **городская специфика**: определяется в `cities/<город>/rules/`. Общая трёхблочная структура и обязательные элементы ниже — каркас, в который подставляются городские значения. Шаблон ниже приведён на парижском инстансе.

> Париж 2010: ночь без дневного света, мокрые поверхности, янтарь vs холодная синь, Haussmann/брусчатка, атмосферный туман, без толпы, кинематографичная композиция; референсы — ночные фото Парижа + VtM: Bloodhunt + нуар. Полный эталон — [`cities/paris/rules/paris_canon.md`](../../cities/paris/rules/paris_canon.md).

---

## Структура промта — три блока

**Блок 1 — Место:**
`[конкретное описание локации], Paris [округ] [год], night`

**Блок 2 — Атмосфера:**
`wet [тип поверхности] reflecting [источник света], [тип архитектуры], atmospheric fog and mist, warm amber [источник] contrast cold dark blue night sky, [специфический световой акцент], no people / lone shadowy silhouette`

**Блок 3 — Стиль и размер:**
`cinematic [wide-angle/street-level/low angle] composition, dark gothic World of Darkness atmosphere, photorealistic concept art, VtM Bloodhunt visual style, highly detailed, 1920x1080`

---

## Обязательные стилистические элементы

Каждый промт локации **обязан** содержать все перечисленные элементы. Строки, помеченные 🔒, копируются **дословно** без изменений. Строки с `[скобками]` — подставить значение под локацию.

| # | Элемент | Точная фраза / правило |
|---|---|---|
| 1 | Место и время | `[описание локации], Paris [год], night` |
| 2 | Мокрая поверхность | `wet [cobblestones / pavement / stone / concrete] reflecting [источник света]` |
| 3 | Туман 🔒 | `atmospheric fog and mist` |
| 4 | Световой контраст | `warm amber [streetlights / lantern / floodlights] contrast cold dark blue [sky / night]` |
| 5 | Люди | `no people` **или** `lone shadowy silhouette` — не оба |
| 6 | Композиция | `cinematic [wide-angle / street-level / low angle / corridor] composition` |
| 7 | Атмосфера WoD 🔒 | `dark gothic World of Darkness atmosphere` |
| 8 | Стиль рендера 🔒 | `photorealistic concept art` |
| 9 | Визуальный стиль 🔒 | `VtM Bloodhunt visual style` |
| 10 | Детализация 🔒 | `highly detailed` |
| 11 | Разрешение 🔒 | `1920x1080` |

### Фиксированный хвост промта (копировать дословно в конец каждого промта)

```
cinematic [УГОЛ] composition, dark gothic World of Darkness atmosphere, photorealistic concept art, VtM Bloodhunt visual style, highly detailed, 1920x1080
```

### Допустимые значения для переменных частей

**`[УГОЛ]`** — выбрать по типу локации:
- `wide-angle` — открытые площади, фасады зданий, набережные
- `street-level` — улицы, переулки, рыночные кварталы
- `low angle` — кладбища, парки, зловещие места
- `corridor` — метро, катакомбы, подземные переходы

**`wet [ПОВЕРХНОСТЬ]`** — выбрать по локации:
- `wet cobblestones` — исторические кварталы, переулки
- `wet pavement` — современные улицы, площади
- `wet stone` — набережные, кладбища, подземные тоннели
- `wet concrete` — промзоны, пригороды, деловые кварталы
- `wet tiled floor` — метро, вокзалы

**`[ИСТОЧНИК ТЁПЛОГО СВЕТА]`** — по локации:
- `amber streetlamps` / `amber lantern` — улицы
- `golden floodlights` — исторические здания, опера
- `orange streetlights` — промзоны, вокзалы
- `warm brasserie windows` — кварталы кафе, богема
- `neon signs` — Пигаль, Барбес, ночные клубы

---

## Что НЕ включать

- ❌ Дневное освещение или солнечный свет
- ❌ Толпы людей с различимыми лицами
- ❌ Современные элементы позже 2010 года
- ❌ Anime / cartoon / illustration стиль
- ❌ Текст, водяные знаки на изображении
- ❌ Яркие насыщенные цвета без тёмного контраста
- ❌ Кровь, раны, увечья, явные признаки насилия — жестокость не описывается явно; атмосфера угрозы передаётся через свет, тень, позу, взгляд

## Формат раздела промтов в карточке локации

```markdown
## 🎨 Промт для генерации изображения

**GPT / DALL-E 3:**
```
[позитивный промт, 1920x1080]
```

**Негативный промт (SD / Flux):**
```
daytime, sunlight, crowds of people, faces in foreground, modern post-2010 elements, anime, cartoon, flat lighting, low quality, blurry, text overlay, watermark, oversaturated colors, 3D plastic render, deformed
```
```

---

---

### Universal Dark Fantasy Portrait Prompt

> ⚠️ **Это референс СТИЛЯ, а не шаблон содержания.** Пример ниже намеренно обобщён («elegant ancient vampire aristocrat») и потому **нарушает 🔒-правило «никаких обобщений»** — копировать его как промт персонажа нельзя. Используй его только для тона/света/среды (Блок 2–3); описание персонажа (Блок 1) всегда строится из секции «Внешность» конкретной карточки.
>
> ⚠️ **Устаревшая по медиуму ссылка.** Лексика ниже («digital painting», «oil-paint brushstrokes», «concept art», «artstation») — старая формулировка, до перехода на фотореалистичный эталон (см. «Эталон стиля» и Блок 3 в разделе НПС выше). Бери отсюда только композицию/свет/настроение — медиум (живопись vs фотография) всегда берётся из актуального правила НПС, а не из этого блока.

(референс тона для MidJourney, Stable Diffusion, Flux, DALL·E)

**ENGLISH VERSION:**

> Cinematic dark fantasy portrait, elegant ancient vampire aristocrat, three-quarter view, long wavy reddish-chestnut hair falling past shoulders, pale almost grey skin with unnatural smoothness, subtle supernatural beauty, dark oversized sunglasses worn indoors with faint amber glow behind lenses, wide charismatic smile slightly too perfect and unsettling, relaxed posture with absolute confidence, bohemian luxury aesthetic, cream or sand-colored tailored jacket over dark ornate brocade vest, partially unbuttoned white shirt, layered antique rings, bracelets, necklaces, centuries-old jewelry collection, decadent immortal charm
>
> Dramatic low-angle lighting, warm amber light illuminating face from below and side, deep shadows swallowing parts of the figure, high contrast chiaroscuro, deep crimson and black painterly background with abstract swirling brushstrokes and smoke-like textures, rich atmospheric reds and warm gold highlights
>
> Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody supernatural atmosphere, gothic elegance, Vampire the Masquerade aesthetic, decadent immortal nobility, concept art quality, highly detailed skin texture, luxurious fabrics, subtle menace behind charm, sophisticated gothic fashion, painterly realism, artstation quality, masterpiece

---

## Negative Prompt (для SD / Flux)

> low quality, blurry, anime, cartoon, plastic skin, flat lighting, bad anatomy, extra fingers, poorly drawn hands, modern selfie, oversaturated colors, photobash artifacts, duplicate jewelry, smiling goofy expression, cheap clothing, sci-fi elements, cyberpunk neon, low detail background, deformed face, unrealistic eyes

---

# MidJourney Version

> cinematic dark fantasy portrait of an ancient vampire prince, long reddish-chestnut wavy hair, pale grey skin, oversized black sunglasses glowing amber, unsettling charismatic smile, cream tailored jacket over dark brocade vest, antique rings and bracelets, bohemian aristocratic elegance, warm amber cinematic lighting, deep crimson and black textured background, painterly brushstrokes, gothic luxury aesthetic, supernatural atmosphere, moody chiaroscuro, decadent immortal charm, highly detailed oil painting style, dark fantasy concept art --ar 2:3 --stylize 250 --v 7

---

# Stable Diffusion / Flux Enhanced Version

> masterpiece, best quality, cinematic dark fantasy portrait, ancient vampire aristocrat, elegant immortal male, three-quarter portrait, long reddish chestnut wavy hair, pale grey skin, subtle corpse-like perfection, oversized black sunglasses with amber glow, charismatic unsettling smile, cream jacquard jacket, dark brocade vest, open collar shirt, layered antique jewelry, rings, bracelets, gothic aristocratic fashion, dramatic amber rim light, deep black shadows, crimson abstract background, visible oil brushstrokes, painterly realism, gothic atmosphere, supernatural elegance, moody cinematic composition, vampire court aesthetic, dark luxury, high detail textures, atmospheric haze, rich red-black-gold palette, sophisticated menace

---

# Дополнительные стилистические модификаторы

### Если нужно больше:

* **готики**

> cathedral shadows, candlelight atmosphere, ancient nobility, baroque darkness

### Если нужно больше:

* **Vampire the Masquerade**

> modern gothic noir, immortal predator aura, seductive danger, Elysium atmosphere

### Если нужно больше:

* **живописности**

> heavy painterly texture, oil canvas strokes, textured pigments, old master brushwork
>
> ⚠️ Использовать умеренно (или не использовать для карточек НПС) — в избытке этот модификатор уводит результат в иллюстрацию и противоречит фотореалистичному эталону карточек персонажей (см. «Эталон стиля» выше).

### Если нужно больше:

* **кинематографичности**

> cinematic grading, anamorphic lighting, dramatic film still, noir composition

---

# Ключ к этому стилю

Главные элементы, создающие атмосферу:

* pale grey skin + warm amber lighting
* crimson-black background
* photographically detailed skin and fabric, not flat illustration (см. «Эталон стиля» выше — заменяет прежний пункт «painterly brush texture»)
* gothic luxury clothing
* unsettling charisma
* confident relaxed posture
* cinematic chiaroscuro
* subtle film grain instead of visible brushwork
* supernatural elegance instead of horror

---

# Формула для генерации любых персонажей в этом стиле

Можно менять только:

> [тип персонажа] + [цветовая палитра] + [одежда] + [тип сверхъестественности]

Например:

* vampire prince
* fae noble
* infernal aristocrat
* gothic occult detective
* immortal poet
* ancient decadent musician

И стиль сохранится.

---

# Правила написания промтов для НПС (characters/)

## Эталон стиля

> ✅ **Хороший пример** — [`cities/paris/characters/vampires/verene_de_kyustin/art/verene_de_kyustin_01.png`](../../cities/paris/characters/vampires/verene_de_kyustin/art/verene_de_kyustin_01.png): выглядит как кадр из реальной фотосъёмки с тёмной кинематографичной цветокоррекцией — резкая, детализированная кожа и ткань, никаких видимых мазков кисти, фон — чистый абстрактный цветовой замес (красный/чёрный), без намёка на конкретное место.
>
> ❌ **Плохой пример** (тип ошибки, с которым нужно бороться) — портрет, где фон читается как **космос/туманность/энергетический портал** (а не плоский цветовой замес), а кожа имеет эффект **трещин камня/мрамора** вместо живой текстуры; общее ощущение — иллюстрация фэнтези-арта, а не фотография. Если результат тянет в эту сторону — промт нарушает правила ниже.

## Размер изображения

🔒 Все промты персонажей **обязаны** заканчиваться размером `1023x1537` (вертикальный портрет ~2:3) — копировать дословно в конец Блока 3.

## Структура — три блока

**Блок 1 — Персонаж:**
Cinematic hyperrealistic portrait, [тип существа / роль], [ракурс], [внешность: волосы, кожа, глаза], [общий стиль одежды без конкретики предметов], [поза / язык тела], [выражение + психологический подтекст]

**Блок 2 — Свет и фон:**
[тип освещения], [рим-лайт: цвет и откуда], [тени], **abstract flat color-wash background, soft smoke-like gradient, single dominant hue, no shapes or forms within the background** (никогда — конкретное место, никогда — космос/туманность/энергия/портал), [атмосферные детали]

> Для вампиров доминирующий цвет рим-лайта/фона задаётся кланом персонажа (см. `CLAN_PROMPT_ACCENT` в `web/server.js`, веб-генератор подставляет автоматически) — единая цветовая идентичность клана во всех портретах. Не каноничный лор, чисто оформительское решение; не влияет на цвет кожи/глаз/волос — те строятся только из «Внешность» карточки.
>
> Для НЕ-вампиров (mortals, fairies, werewolves, mages, hunters — у них нет клана и записи в `CLAN_PROMPT_ACCENT`): фон по умолчанию — **deep crimson-red and black** (тот же дух, что и у вампирских карточек), если у города/линейки нет отдельного указания цвета. Цель — одна и та же абстрактная текстурная эстетика для ВСЕХ карточек персонажей города, вне зависимости от линейки.
>
> ❌ Что недопустимо в Блоке 2 (явный список — не ограничивается им, но эти слова/образы триггерят откат к фэнтези-фону и должны быть прямо запрещены в промте):
> - конкретная архитектура (улицы, здания, интерьеры комнат), пейзажи (лес, кладбище, побережье), узнаваемые места из карточки локации
> - фэнтезийные миры/руины/замки/порталы на фоне
> - **космос, галактика, туманность, звёзды, энергетические вихри/свечения, магические порталы** — любой фон, который читается как *место* или *явление*, а не плоский цвет
>
> Фон портрета — это **цвет и мягкий градиент**, не место и не явление. Если нужна сцена «персонаж в локации» — это отдельный тип промта (см. правила локаций выше), а не карточка персонажа.

**Блок 3 — Стиль / Качество:**
Hyperrealistic cinematic portrait photography, fashion-editorial color grading, sharp fine detail on skin texture and fabric, natural human skin (никогда — cracked/marble/stone skin texture), subtle gothic noir atmosphere, Vampire the Masquerade aesthetic, high-end editorial photography quality, masterpiece, 1023x1537

> Ключевой сдвиг от прежней версии правил: раньше Блок 3 требовал «digital painting / oil-paint effect / concept art / artstation» — это и уводило результат в сторону иллюстрации/фэнтези-арта. Эталонный стиль карточек — **фотография с кинематографичной цветокоррекцией**, не картина. Видимые мазки кисти, эффект масляной живописи, «concept art» / «artstation» лексика — больше не используются в Блоке 3 персонажей.

## Что НЕ включать в промт карточки

- ❌ «take pose from reference» — поза задаётся индивидуально при генерации
- ❌ Название персонажа или имена собственные
- ❌ Кровь, раны, увечья, явные признаки насилия — угроза и опасность передаются через взгляд, тень, позу, освещение, не через прямые образы жестокости
- ❌ «digital painting», «oil-paint effect», «visible brushstrokes», «concept art», «artstation» — уводит результат в иллюстрацию вместо фотореализма (см. «Эталон стиля» выше)
- ❌ «nebula», «galaxy», «cosmic energy», «swirling portal», «cracked stone/marble skin» — фон/кожа не должны читаться как место/явление/камень

## Негативный промт (стандартный для всех)

> digital painting, illustration, anime, cartoon, oil painting, visible brushstrokes, concept art, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, 3D render, CGI, cracked skin, marble skin, stone texture skin, nebula background, galaxy background, cosmic energy background, swirling portal background.
