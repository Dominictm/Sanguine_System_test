---
name: Sanguine System
description: Архивный интерфейс ведения хроник Vampire: The Masquerade — кодекс, не дашборд
colors:
  void-black: "#07050a"
  void-black-2: "#0d0a10"
  void-black-3: "#120f18"
  void-black-4: "#181420"
  border-blood: "rgba(139, 0, 0, .22)"
  border-blood-bright: "rgba(180, 20, 0, .45)"
  blood-oath: "#8B0000"
  blood-oath-bright: "#B80000"
  reliquary-gold: "#B8860B"
  reliquary-gold-bright: "#DAA520"
  crimson-signal: "#DC143C"
  parchment-text: "#E8E0D0"
  parchment-text-dim: "#a89880"
  parchment-text-muted: "#8c8279"
  state-success: "#7dce82"
  state-error: "#e87070"
  state-danger: "#cc2200"
  state-info: "#8ab4f8"
  lore-violet: "#a78bca"
typography:
  display:
    fontFamily: "'Cinzel Decorative', 'Cinzel', serif"
    fontSize: "clamp(35px, 4vw, 64px)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.14em"
  heading:
    fontFamily: "'Cinzel', serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.18em"
  body:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'Share Tech Mono', 'Courier New', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  hairline: "1px"
  sm: "2px"
  md: "3px"
  lg: "6px"
  xl: "10px"
spacing:
  xs: "4px"
  sm: "10px"
  md: "16px"
  lg: "20px"
  xl: "28px"
  xxl: "44px"
components:
  button-primary:
    backgroundColor: "{colors.blood-oath}"
    textColor: "{colors.parchment-text}"
    typography: "{typography.heading}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
  button-primary-hover:
    backgroundColor: "{colors.blood-oath-bright}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.reliquary-gold}"
    typography: "{typography.heading}"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
  button-secondary-hover:
    textColor: "{colors.reliquary-gold-bright}"
  card-character:
    backgroundColor: "{colors.void-black-3}"
    textColor: "{colors.parchment-text}"
    rounded: "{rounded.sm}"
    padding: "18px"
  modal-box:
    backgroundColor: "{colors.void-black-2}"
    textColor: "{colors.parchment-text}"
    rounded: "{rounded.md}"
    padding: "40px 44px"
---

# Design System: Sanguine System

## 1. Overview

**Creative North Star: "Запечатанный кодекс"**

Sanguine System — это не панель управления, а фолиант Камарильи, который GM открывает перед сессией. Каждый экран ведёт себя как страница архива: тёмная, плотная, безмолвная до тех пор, пока курсор не коснётся записи. Тогда — и только тогда — проступает кровяной отблеск (`--glow`), будто страница узнаёт прикосновение. Интерфейс не украшает себя; он хранит. Иерархия строится через три шрифта-голоса — Cinzel Decorative для титулов, Cinzel для заголовков-печатей, Cormorant Garamond для самого текста хроник — а не через декоративные элементы.

Система явно отказывается от: **horror splatter** (брызги крови, хэллоуин-эстетика — слишком буквально для архива), **SaaS-дашборда** (Linear/Jira/Notion — функциональная нейтральность убивает атмосферу кодекса), **геймерской яркости D&D Beyond/Roll20** (иконки фэнтези, детская энергия), **монохромного утилитаризма Obsidian** (markdown-утилита без характера). Кровь и золото здесь не фон и не украшение — это **сигнал**, появляющийся только там, где требуется действие или внимание GM.

**Key Characteristics:**
- Почти беззвучная база: `#07050a` фон, рамки на 22% прозрачности крови — система говорит шёпотом, пока её не спросят.
- Три типографических голоса (display / heading / body), каждый закреплён за одним уровнем иерархии — никогда не смешиваются.
- Острые, полные рамки везде (1–2px), никаких декоративных полос-акцентов слева.
- Глубина — не материальная тень, а кровяное сияние (`--glow`) вокруг активного/важного.

## 2. Colors

Палитра — почти монохромная тьма с двумя точечными сигналами: кровь для действия, золото для церемониального/вторичного. Это **Committed**-стратегия на одном доминирующем тёмном холсте, а не Restrained-нейтрали с акцентом — тьма здесь несёт смысл, не просто фон.

### Primary
- **Blood Oath** (`#8B0000`): главный сигнал действия — кнопки отправки форм, активный пункт навигации, hover-рамка карточек, индикаторы ошибок/опасности по смыслу клятвы кровью.
- **Blood Oath Bright** (`#B80000`): hover/active состояние Blood Oath — клятва "усиливается" при контакте.

### Secondary
- **Reliquary Gold** (`#B8860B`): церемониальные и вторичные элементы — секция-заголовки модалок, вторичные кнопки, бейджи целостности, акценты Элизиума/слухов. Золото реликвария — то, что показывают, не то, чем действуют.
- **Reliquary Gold Bright** (`#DAA520`): hover-состояние золота.

### Neutral
- **Void Black** (`#07050a`): базовый фон страницы — почти беззвучная тьма архива.
- **Void Black 2/3/4** (`#0d0a10` / `#120f18` / `#181420`): восходящая лестница поверхностей — модалки, карточки, hover-карточки. Каждый шаг чуть светлее, как страница, поднесённая ближе к свече.
- **Parchment Text** (`#E8E0D0`): основной текст — тёплый пергамент, не белый.
- **Parchment Text Dim / Muted** (`#a89880` / `#8c8279`): вторичный и третичный текст — лейблы, подсказки, метаданные.
- **Border Blood** (`rgba(139, 0, 0, .22)`): рамки по умолчанию — кровь, растворённая в темноте, едва заметная.

### Named Rules
**The Whisper-Until-Touched Rule.** Интерфейс в покое почти не использует цвет — кровь и золото проступают только на hover/focus/active. Если элемент кричит цветом в состоянии покоя, это нарушение системы.

**The Full-Border Rule.** Акцентные рамки — полные (`border: 1–2px solid`) или сплошная заливка боковой плашки шириной 3px на всю высоту карточки (`.char-card::before`), никогда тонкая цветная полоска-стрип слева/справа на тексте или списке. Если акцент — это `border-left` толще 1px на строке списка, это не Sanguine System, а заимствованный SaaS-паттерн.

## 3. Typography

**Display Font:** Cinzel Decorative, с запасным Cinzel, serif
**Body Font:** Cormorant Garamond, с запасным Georgia, serif
**Label/Mono Font:** Share Tech Mono, с запасным Courier New, monospace

**Character:** Контраст оси serif/serif+mono — два церемониальных serif-голоса (Cinzel для печатей, Cormorant для тела) против холодного Share Tech Mono для данных и вывода инструментов. Голос меняется по функции, не по вкусу.

### Hierarchy
- **Display** (400, clamp(35px, 4vw, 64px), line-height 1.15, letter-spacing 0.14em, uppercase): логотип, крупные титулы городов/хроник.
- **Headline** (400, 15–22px, letter-spacing 0.18–0.22em, uppercase): заголовки модалок, навигация, кнопки — всё, что Cinzel.
- **Title** (400, 17–25px, italic допустим): названия карточек персонажей/локаций, клан под именем.
- **Body** (400, 22px база / до 25px в карточках, line-height 1.5): основной текст хроник и описаний на Cormorant Garamond, максимум 65–75ch на строку.
- **Label** (400, 10–13px, letter-spacing 0.04–0.2em, Share Tech Mono): вывод инструментов, теги, технические метаданные.

### Named Rules
**The Печать Rule.** Всё, что выглядит как заголовок/кнопка/навигация, набрано Cinzel в uppercase с letter-spacing ≥0.1em — будто оттиснутая печать, а не обычный UI-лейбл.

## 4. Elevation

**Кровяное сияние.** Система не использует material-тени как способ показать высоту поверхности. Вместо ambient box-shadow глубина передаётся через **сияние** (`var(--glow)`, `rgba(180, 0, 0, .35)`) вокруг активных/сфокусированных элементов и через тяжёлые, почти непрозрачные чёрные тени вокруг модалок (`0 0 80px rgba(139, 0, 0, .45), 0 0 0 1px rgba(139, 0, 0, .1)`), которые читаются не как "поднятая карточка", а как объект, физически вырванный из тёмного фона ритуалом открытия.

### Shadow Vocabulary
- **glow-accent** (`box-shadow: 0 0 20px var(--glow)`): hover/focus интерактивных элементов — кнопки, инпуты, активные иконки.
- **modal-emergence** (`box-shadow: 0 0 80px rgba(139, 0, 0, .45), 0 0 0 1px rgba(139, 0, 0, .1)`): модальные окна при открытии — кровяной ореол вместо нейтральной тени.
- **panel-lift** (`box-shadow: 0 8px 48px rgba(0, 0, 0, .8)`): крупные оверлеи/лайтбоксы — глубокая чёрная тень без цвета, для максимальной изоляции от фона.

### Named Rules
**The No-Material-Shadow Rule.** Серые/нейтральные box-shadow для "обычной" высоты запрещены. Если элементу нужна глубина — это либо кровяное/золотое сияние (значимость), либо чёрный провал (модальная изоляция), третьего нет.

## 5. Components

Компоненты — **сдержанные и торжественные**: острые/едва скруглённые углы, полные рамки, минимум движения в покое, явный ответ при касании.

### Buttons
- **Shape:** почти острые углы (`border-radius: 2px`).
- **Primary:** заливка Blood Oath, рамка Blood Oath Bright на 1px, текст Parchment, паддинг `12px 28px`, Cinzel uppercase letter-spacing 0.1em.
- **Hover / Focus:** заливка светлеет до Blood Oath Bright, появляется `glow-accent`; переход только по `background`/`border-color` (`.15s`), без масштабирования.
- **Secondary / Ghost:** прозрачный фон, рамка и текст Reliquary Gold; hover — лёгкая золотая подложка (`rgba(184,134,11,.15)`) + `glow-accent` золотого тона.

### Cards / Containers
- **Corner Style:** `border-radius: 2px` — практически без скругления.
- **Background:** Void Black 3, светлеет до Void Black 4 на hover.
- **Shadow Strategy:** в покое — без тени; на hover — едва заметный подъём (`translateY(-1px)`) плюс кровяная боковая плашка 3px (полноширинная, не текстовый стрип).
- **Border:** 2px solid Border Blood, ярче на hover.
- **Internal Padding:** 18px (карточка без арта); карточки с артом — 0 с внутренним градиентным оверлеем для текста.
- **Reveal:** карточки появляются через `card-reveal` keyframes (fade + translateY 6px) со ступенчатым `animation-delay` по индексу — архив "проявляется" построчно, а не возникает весь сразу.

### Inputs / Fields
- **Style:** заливка Void Black 3, рамка Border Blood 1px, `border-radius: 2px`, паддинг `10px 14px`, Cormorant Garamond.
- **Focus:** рамка становится Blood Oath Bright; без свечения (свечение зарезервировано за кнопками и модалками).
- **Placeholder:** Parchment Text Muted.

### Navigation
- Боковая колонка, пункты — Cinzel uppercase, letter-spacing 0.18em, `border-left: 2px solid transparent`, заполняется Blood Oath при hover/active вместе с подложкой `rgba(139,0,0,.08–.14)`. *(Это единственное системное исключение из The Full-Border Rule — двухпиксельная левая полоса здесь функционирует как индикатор активного раздела навигации, а не декоративный акцент на тексте/списке.)*

### Modal (signature component)
Модалка — портал в архив: затемнённый фон (`rgba(0,0,0,.78)` + `blur(4px)`), сама панель всплывает с `translateY(8px) scale(.98) → translateY(0) scale(1)` и кровяным ореолом (`modal-emergence`). Открытие/закрытие управляется единым механизмом `visibility + opacity + pointer-events`, не `display`, поэтому закрытие тоже плавно гаснет, а не обрывается.

## 6. Do's and Don'ts

### Do:
- **Do** использовать Blood Oath (`#8B0000`) только как сигнал действия/опасности — не как декоративный фон.
- **Do** оставлять элементы безмолвными в покое; цвет и сияние проявляются на hover/focus/active (The Whisper-Until-Touched Rule).
- **Do** использовать полные рамки (1–2px solid) или полноширинные боковые плашки (3px+, на всю высоту карточки) для акцента.
- **Do** держать радиусы в диапазоне 1–6px (10px — редкое исключение для крупных модалок-лайтбоксов); острые углы — часть характера, не недосмотр.
- **Do** анимировать через `transform`/`opacity` с `var(--ease)` (`cubic-bezier(.4,0,.2,1)`) и токенами `--dur-fast`/`--dur-base`; уважать `prefers-reduced-motion`.

### Don't:
- **Don't** использовать тонкую цветную полосу-стрип (`border-left`/`border-right` > 1px) как акцент на строке списка, карточке или алерте — это SaaS-клише, прямо противоречащее The Full-Border Rule.
- **Don't** добавлять horror-splatter эстетику (брызги крови, хэллоуин-шрифты) — слишком буквально для архивного тона (анти-референс PRODUCT.md).
- **Don't** превращать интерфейс в SaaS-дашборд (Linear/Jira/Notion) — функциональная нейтральность убивает атмосферу кодекса (анти-референс PRODUCT.md).
- **Don't** добавлять геймерскую яркость D&D Beyond/Roll20 — иконки фэнтези и детская энергия чужды тону GM-инструмента (анти-референс PRODUCT.md).
- **Don't** скатываться в монохромный утилитаризм Obsidian — markdown-утилита без характера (анти-референс PRODUCT.md).
- **Don't** использовать материальные серые тени для обычной высоты — глубина передаётся только кровяным/золотым сиянием или чёрным провалом модалки.
- **Don't** анимировать `display`/layout-свойства напрямую — используйте `visibility`+`opacity`+`pointer-events`, как в `.modal-overlay`.
