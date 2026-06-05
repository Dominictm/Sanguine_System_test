# Правила промтов для Локаций (locations/)

## Структура папок

**Парижские локации** (события в Париже):
```
locations/[Район]_[Номер]/[Название_локации]/[Название].md
```

**Локации вне Парижа** (другие города, страны, внепарижские события модуля):
```
locations/Другие/[Название_модуля]/[Название_локации]/[Название].md
```

> Пример: локация «Замок в Провансе» для модуля `январь_2011_прованс` →
> `locations/Другие/январь_2011_прованс/Замок_в_Провансе/Замок_в_Провансе.md`

Формат карточки — **одинаковый** для обоих случаев. Промт адаптируется под реальное место и время суток (если не ночь — указать явно).

---

## Эталонный стиль

Все изображения локаций создаются в едином визуальном стиле:
- **Ночной Париж 2010** — никакого дневного света
- **Мокрые поверхности** — дождь, туман, отражения
- **Контраст тёплого и холодного** — янтарные фонари vs холодное синее небо
- **Haussman или специфическая архитектура** — европейские фасады, брусчатка
- **Атмосферный туман** — дымка, мист, испарения
- **Без толпы** — никого или одна тёмная силуэт
- **Кинематографичная композиция** — широкий угол, уровень улицы, низкий угол

Визуальные референсы: ночные фотографии Парижа + концепт-арт VtM: Bloodhunt + нуар-кинематограф

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

(подходит для MidJourney, Stable Diffusion, Flux, DALL·E)

**ENGLISH VERSION (recommended):**

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

### Если нужно больше:

* **кинематографичности**

> cinematic grading, anamorphic lighting, dramatic film still, noir composition

---

# Ключ к этому стилю

Главные элементы, создающие атмосферу:

* pale grey skin + warm amber lighting
* crimson-black background
* painterly brush texture
* gothic luxury clothing
* unsettling charisma
* confident relaxed posture
* cinematic chiaroscuro
* visible texture and brushwork
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

## Структура — три блока

**Блок 1 — Персонаж:**
Cinematic dark fantasy portrait, [тип существа / роль], [ракурс], [внешность: волосы, кожа, глаза], [общий стиль одежды без конкретики предметов], [поза / язык тела], [выражение + психологический подтекст]

**Блок 2 — Свет и фон:**
[тип освещения], [рим-лайт: цвет и откуда], [тени], [цвет и текстура фона], [атмосферные детали]

**Блок 3 — Стиль / Качество:**
Dark fantasy digital painting, visible painterly brushstrokes, textured oil-paint effect, cinematic composition, moody gothic atmosphere, Vampire the Masquerade aesthetic, concept art quality, painterly realism, artstation quality, masterpiece

## Что НЕ включать в промт карточки

- ❌ «take pose from reference» — поза задаётся индивидуально при генерации
- ❌ Название персонажа или имена собственные

## Негативный промт (стандартный для всех)

> photorealistic photography, digital art, anime, cartoon, illustration, watermark, text overlay, blurry, low quality, artifacts, deformed anatomy, extra limbs, oversaturated colors, bright white background, 3D render, CGI.
