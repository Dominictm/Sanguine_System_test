'use strict';
// Роутер AI-генерации: внешность/промт/характер/биография персонажа (Vision + text),
// AI Director (propose), генерация прозы дневников (OpenRouter/OpenAI и Claude CLI),
// список бесплатных моделей OpenRouter, canon-check (проверка непротиворечивости канона).
// Фабрика с DI: makeGenerationClient/_isOA/_oaCall/callOpenAI/callOpenRouter/runClaude и
// OAuth-хелперы остаются в server.js (AI-слой пока живёт там, E1.2) и приходят через DI.

const express = require('express');
const path    = require('path');
const fs      = require('fs').promises;
const { serverError, aiRateLimit, callAnthropicWithRetry } = require('../lib/http');
const {
  ROOT, chroniclesDir, charsDir,
  reqCity, writeFileAtomic, invalidateChars,
  getAllCharacters, EDITABLE_FIELD_MAP,
} = require('../lib/db');
const { loadLiteraryStyle, loadDiaryStyleRules, compressChronicleEvents, parseEventsText } = require('../lib/context_builder');

// «Информация» — карточные факты (без биографии/внешности/голоса/характера, которые
// генераторы передают отдельно) для подмешивания в AI-промты, чтобы сгенерированный
// текст не противоречил клану/секте/роли и т.д. персонажа.
const INFO_KEYS_FOR_PROMPT = [
  'clan', 'sect', 'generation', 'birthYear', 'embraceYear', 'sire', 'childe',
  'location', 'hierarchy', 'disciplines', 'derangements', 'profession', 'role', 'belonging',
  'race', 'kith', 'court', 'title', 'features', 'relatives', 'attitude',
];
function charInfoLines(char) {
  const lines = [];
  if (char.gender && !char.gender.includes('⚠️')) lines.push(`Пол: ${char.gender}`);
  if (char.status && char.status !== '—') lines.push(`Статус: ${char.status}`);
  for (const key of INFO_KEYS_FOR_PROMPT) {
    const v = char[key];
    if (v && !String(v).includes('⚠️') && v !== '—') lines.push(`${EDITABLE_FIELD_MAP[key]}: ${v}`);
  }
  return lines.join('\n');
}
function charRelationshipLines(char) {
  return (char.relationships || [])
    .filter(r => r.target)
    .map(r => r.description ? `${r.target} — ${r.description}` : r.target)
    .join('\n');
}

// English color-family phrases for the AI prompt's lighting/background accent (Block 2),
// keyed by clan. Mirrors the hex identity of CLAN_COLORS in web/public/scripts.js (the
// decorative modal-tint palette) so a clan reads as the same color in the UI and in the
// generated portrait — not canonical, purely a visual-consistency device across all images.
const CLAN_PROMPT_ACCENT = {
  'Асамиты':              'deep blood-red',
  'Бруха':                'burnt rust-orange',
  'Вентру':                'deep steel-blue',
  'Гэнгрел':               'earthy ochre-brown',
  'Джованни':              'dark muted plum-grey',
  'Ласомбра':              'deep indigo-black',
  'Малкавиан':             'vivid violet-purple',
  'Носферату':             'murky olive-green',
  'Равнос':                'warm amber-orange',
  'Последователи Сета':    'golden mustard-amber',
  'Тореадор':              'rose-crimson pink',
  'Тремер':                'deep violet-magenta',
  'Тзимище':               'dark oxblood-red',
  'Баали':                 'near-black blood-red',
  'Дочери Какофонии':      'slate blue-grey',
  'Каппадокийцы':          'ashen grey',
  'Нагараджа':             'burnt sienna-brown',
  'Салубри':               'deep teal-blue',
  'Самеди':                'dark plum-purple',
  'Серпанты Света':        'dull olive-yellow',
};

// ── OpenRouter prose generation — shared context builder ──────────────────────
async function buildProseContext(city, valid) {
  // 1. diary_rules.md + literary_style.md
  const diaryRules = await fs.readFile(
    path.join(ROOT, 'system', 'rules', 'diary_rules.md'), 'utf-8').catch(() => '');
  const litStyle = await loadLiteraryStyle();

  // 2. Read each stub file + extract referenced characters and chronicle facts
  const stubContents = [];
  const charSlugsNeeded = new Set();
  const eventsFilesNeeded = new Set();

  for (const rel of valid) {
    const txt  = await fs.readFile(path.resolve(ROOT, rel), 'utf-8').catch(() => '');
    stubContents.push({ rel, txt });

    // Extract character slug from path: characters/<lineage>/<slug>/journal/...
    const slugMatch = rel.match(/characters\/[^/]+\/([^/]+)\//);
    if (slugMatch) charSlugsNeeded.add(slugMatch[1]);

    // Extract FACTS references (chronicle events.md links in comments)
    const factsMatch = txt.match(/ФАКТЫ[:\s]+([^\n>]+events\.md[^\n]*)/gi);
    if (factsMatch) {
      for (const fm of factsMatch) {
        const pathMatch = fm.match(/(cities\/[^)\s]+events\.md)/);
        if (pathMatch) eventsFilesNeeded.add(pathMatch[1]);
      }
    }
    // Also try to find chronicle from path
    const chrMatch = rel.match(/chronicles\/([^/]+)\//);
    if (chrMatch) {
      eventsFilesNeeded.add(`cities/${city}/chronicles/${chrMatch[1]}/events.md`);
    }
  }

  // 3. Read character cards
  const chars = await getAllCharacters(city);
  const charCards = [];
  for (const slug of charSlugsNeeded) {
    const ch = chars.find(c => c.slug === slug);
    if (!ch) continue;
    const cardPath = path.join(charsDir(city), ch.lineageFolder, ch.slug, `${ch.slug}.md`);
    const card = await fs.readFile(cardPath, 'utf-8').catch(() => null);
    if (card) charCards.push(`### Карточка: ${ch.name}\n${card}`);
  }

  // 4. Read chronicle events
  const eventsChunks = [];
  for (const evRel of eventsFilesNeeded) {
    const evTxt = await fs.readFile(path.join(ROOT, evRel), 'utf-8').catch(() => null);
    if (evTxt) eventsChunks.push(`### ${evRel}\n${evTxt.slice(0, 6000)}`);
  }

  return { diaryRules, litStyle, stubContents, charCards, eventsChunks };
}

// Фабрика: server.js передаёт AI-хелперы при монтировании.
module.exports = function generationRouter({
  makeGenerationClient, isOA, oaCall, oaModels, validModels,
  callOpenAI, callOpenRouter, runClaude, defaultClaudeModel,
}) {
  const router = express.Router();

  // ── Generate appearance from art images via Vision API ────────────────────────
  router.post('/api/characters/:slug/generate-appearance', aiRateLimit, express.json(), async (req, res) => {
    try {
      // Validate cheap inputs BEFORE constructing a generation client (no API call needed to 404/400).
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const artDir = path.join(charsDir(city), char.lineageFolder, char.slug, 'art');
      const files  = await fs.readdir(artDir).catch(() => []);
      const imgs   = files.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).sort();
      if (!imgs.length) return res.status(400).json({ error: 'Нет изображений в папке art/ персонажа' });

      const preferSource = req.body?.preferSource || null;
      const orModel      = req.body?.orModel      || null;
      const gen = await makeGenerationClient(preferSource, orModel);

      // OAuth tier has tighter limits — cap at 1 image; OpenRouter/API-key can use more
      const MAX_IMGS = gen.source === 'claude-login' ? 1 : 4;

      const imageBuffers = [];
      for (const f of imgs.slice(0, MAX_IMGS)) {
        const buf  = await fs.readFile(path.join(artDir, f));
        const ext  = f.split('.').pop().toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                   : ext === 'png'  ? 'image/png'
                   : ext === 'webp' ? 'image/webp' : 'image/gif';
        imageBuffers.push({ buf, mime });
      }

      const lineageName = { vampires: 'вампира', fairies: 'феи / ченджлинга', mortals: 'смертного',
        werewolves: 'оборотня', mages: 'мага', hunters: 'охотника' }[char.lineageFolder] || 'персонажа';

      const gender = char.gender && !char.gender.includes('⚠️') ? char.gender : '';
      const genderNote = gender.startsWith('Неизвестно')
        ? '\n- Пол персонажа намеренно неопределим (часть лора) — пиши нейтрально, не используй гендерные местоимения/окончания там, где это можно обойти.'
        : gender
          ? `\n- Пол персонажа: ${gender}. Используй грамматически верный род (окончания глаголов/прилагательных) — не угадывай по картинке, если она неочевидна.`
          : '';
      const litStyle = await loadLiteraryStyle();
      const systemPrompt = `Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade. Пиши прозу строго по литературному стилю проекта.${litStyle ? `\n\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}` : ''}`;
      const userPrompt   = `Перед тобой ${imageBuffers.length > 1 ? `${imageBuffers.length} изображения` : 'изображение'} ${lineageName} по имени ${char.name}.\n\nОпиши внешность для карточки. Требования:\n- 3–5 конкретных визуальных маркеров (лицо, волосы, кожа, глаза, одежда, характерные детали)\n- Стиль: лаконичный, образный, готический. Без «воды».\n- Язык: русский.\n- Формат: один абзац, без списков и заголовков.\n- Упомяни всё необычное, характерное, запоминающееся.\n- Запрет: не упоминать кровь, раны, увечья, явные признаки насилия — даже если они видны на изображении.${genderNote}`;

      // Некоторые бесплатные модели за роутером openrouter/free иногда возвращают
      // не описание, а артефакт модерационного классификатора («User Safety: safe»
      // и т.п.) — валидный непустой текст, но не то, что просили. Раньше это тихо
      // принималось как успех и автосохранялось поверх настоящей внешности персонажа.
      const _isBogusAppearance = text => !text || text.trim().length < 25
        || /^(user safety|content policy|i cannot|i can'?t assist|as an ai)/i.test(text.trim());

      let appearance = '';
      const imgContents = imageBuffers.map(({ buf, mime }) => ({
        type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') },
      }));
      const claudeModel = validModels().includes(req.body?.model) ? req.body.model : 'claude-opus-4-8';
      const callClaudeVision = client => callAnthropicWithRetry(client, {
        model: claudeModel, max_tokens: 300, system: systemPrompt,
        messages: [{ role: 'user', content: [...imgContents, { type: 'text', text: userPrompt }] }],
      }, { label: 'generate-appearance' }).then(m => m.content[0]?.text?.trim() || '');

      // Пробует все vision-модели OpenRouter (тот же curated-список, что у основной
      // OA-ветки), возвращает первый непустой и не-«бесполезный» ответ.
      const tryOpenRouterModels = async label => {
        const orGen = { source: 'openrouter', model: process.env.OPENROUTER_MODEL || 'openrouter/free' };
        for (const m of oaModels(orGen)) {
          try {
            console.warn(`[generate-appearance] ${label}, пробуем OpenRouter (${m})...`);
            const out = (await callOpenRouter(m, systemPrompt, userPrompt, imageBuffers)).trim();
            if (!_isBogusAppearance(out)) return out;
            console.warn(`[generate-appearance] OpenRouter ${m} вернул нерелевантный ответ, пробуем следующую...`);
          } catch (orErr) {
            console.warn(`[generate-appearance] OpenRouter ${m} не сработал (${orErr.status}), пробуем следующую...`);
          }
        }
        return '';
      };

      if (isOA(gen)) {
        // Try primary model, then fallbacks if endpoint not found
        const modelsToTry = oaModels(gen);
        let lastErr;
        for (const m of modelsToTry) {
          try {
            const out = await oaCall(gen)(m, systemPrompt, userPrompt, imageBuffers);
            if (_isBogusAppearance(out)) {
              console.warn(`[generate-appearance] model ${m} вернул нерелевантный ответ, пробуем следующую...`);
              lastErr = Object.assign(new Error(`Модель «${m}» вернула нерелевантный ответ вместо описания.`), { status: 502 });
              continue;
            }
            appearance = out;
            if (m !== gen.model) console.log(`[generate-appearance] fallback model used: ${m}`);
            break;
          } catch (e) {
            lastErr = e;
            const is429 = e.status === 429;
            console.warn(`[generate-appearance] model ${m} unavailable (${e.status}), trying next...`);
            if (is429) await new Promise(r => setTimeout(r, 800));
          }
        }
        if (!appearance) {
          // Все модели OpenRouter/OpenAI провалились (rate limit, недоступность,
          // мусорный ответ — что угодно) — пробуем Claude (OAuth/API key), если
          // он доступен, прежде чем сдаться.
          try {
            const claudeGen = await makeGenerationClient('claude', null);
            if (claudeGen?.client) {
              console.warn('[generate-appearance] OpenRouter/OpenAI не сработали, пробуем Claude...');
              const out = await callClaudeVision(claudeGen.client);
              if (!_isBogusAppearance(out)) { appearance = out; gen.source = claudeGen.source + '-fallback'; }
            }
          } catch { /* появится ниже общей ошибкой */ }
          if (!appearance) {
            const status = lastErr?.status === 429 ? 429 : (lastErr?.status ?? 502);
            return res.status(status).json({
              error: lastErr?.message || 'Не удалось сгенерировать внешность ни одним из провайдеров.',
              ...(status === 429 ? { rateLimited: true } : {}),
            });
          }
        }
      } else {
        // Anthropic SDK format
        try {
          const out = await callClaudeVision(gen.client);
          if (_isBogusAppearance(out)) throw Object.assign(new Error('Claude вернул нерелевантный ответ вместо описания.'), { status: 502 });
          appearance = out;
        } catch (e) {
          // Claude (OAuth/API key) подвёл — по ЛЮБОЙ причине (rate limit, обрыв сети,
          // мусорный ответ, что угодно ещё): если настроен другой провайдер с
          // поддержкой изображений, пробуем его, прежде чем возвращать ошибку целиком.
          if (process.env.OPENROUTER_API_KEY) {
            const out = await tryOpenRouterModels('Claude не сработал');
            if (out) { appearance = out; gen.source = 'openrouter-fallback'; }
            else if (process.env.OPENAI_API_KEY) {
              console.warn('[generate-appearance] Claude и OpenRouter не сработали, пробуем OpenAI...');
              const oaOut = (await callOpenAI(process.env.OPENAI_MODEL || 'gpt-4o-mini', systemPrompt, userPrompt, imageBuffers).catch(() => '')).trim();
              if (!_isBogusAppearance(oaOut)) { appearance = oaOut; gen.source = 'openai-fallback'; }
            }
          } else if (process.env.OPENAI_API_KEY) {
            console.warn('[generate-appearance] Claude не сработал, пробуем OpenAI...');
            const out = (await callOpenAI(process.env.OPENAI_MODEL || 'gpt-4o-mini', systemPrompt, userPrompt, imageBuffers).catch(() => '')).trim();
            if (!_isBogusAppearance(out)) { appearance = out; gen.source = 'openai-fallback'; }
          }
          if (!appearance) throw e;
        }
      }

      if (!appearance) return res.status(502).json({ error: 'Модель вернула нерелевантный ответ. Попробуйте другой провайдер в настройках AI.' });

      res.json({ ok: true, appearance, imagesUsed: imageBuffers.length, source: gen.source });
    } catch (e) {
      const status = e.status ?? 500;
      const msg    = e.error?.error?.message ?? e.message ?? String(e);
      console.error(`[generate-appearance] ${status}`, msg);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, ...(e.rateLimited ? { rateLimited: true } : {}) });
    }
  });

  // ── Generate image prompt for a character ─────────────────────────────────────
  router.post('/api/characters/:slug/generate-prompt', aiRateLimit, express.json(), async (req, res) => {
    try {
      // Validate cheap inputs BEFORE constructing a generation client (no API call needed to 404/400).
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const appearance = char.appearance && !char.appearance.includes('⚠️') ? char.appearance.trim() : '';
      if (!appearance) return res.status(400).json({ error: 'Заполните поле «Внешность» перед генерацией промта' });

      const preferSource = req.body?.preferSource || null;
      const orModel      = req.body?.orModel      || null;
      const gen = await makeGenerationClient(preferSource, orModel);

      const portretRules = await fs.readFile(path.join(ROOT, 'system', 'rules', 'portret.md'), 'utf-8').catch(() => '');

      const lineageName = { vampires: 'vampire', fairies: 'changeling / fairy', mortals: 'mortal',
        werewolves: 'werewolf', mages: 'mage', hunters: 'hunter' }[char.lineageFolder] || 'character';
      const clan = char.clan && !char.clan.includes('⚠️') ? char.clan : '';
      const clanAccent = clan ? CLAN_PROMPT_ACCENT[clan] : null;
      const gender = char.gender && !char.gender.includes('⚠️') ? char.gender : '';
      const genderEn = gender.startsWith('Мужской') ? 'male' : gender.startsWith('Женский') ? 'female' : '';

      const systemPrompt = 'You are an expert prompt writer for AI image generation (DALL-E 3, Midjourney, Stable Diffusion). You write precise, vivid, technically correct English prompts for dark fantasy gothic RPG art.';
      const userPrompt = `Write an image generation prompt for a Vampire: The Masquerade character card.

Character:
- Name: ${char.name}
- Type: ${lineageName}${clan ? ` (${clan})` : ''}
- Gender: ${genderEn || (gender.startsWith('Неизвестно') ? 'intentionally indeterminate/ambiguous — keep it that way, do not assign male or female markers' : 'not specified — infer only from Appearance below, do not guess beyond it')}
- Appearance (Russian): ${appearance}
${clanAccent ? `- Clan accent color: ${clanAccent} — use ONLY as the rim-light / background tint in Block 2, never for skin, eyes or hair (those come strictly from Appearance above)` : ''}

Rules excerpt:
${portretRules}

Output ONLY valid JSON, no extra text:
{
  "positive": "[Блок 1] <character appearance, pose, clothing — full English translation and expansion>\\n[Блок 2] <lighting, atmosphere, background>\\n[Блок 3] <style, medium, quality keywords>",
  "negative": "<comma-separated negative terms>"
}

Requirements:
- ALL text must be in English
- Positive prompt: exactly 3 blocks labeled [Блок 1], [Блок 2], [Блок 3]
- Block 1: translate character appearance from Russian, expand with specific visual details; reflect the Gender given above (a clear "man"/"woman" marker, or deliberate ambiguity if Gender is indeterminate) — never contradict it
- Block 2: cinematic lighting, mood, background — the background MUST be a flat abstract color-wash (soft smoke-like gradient, single dominant hue, no shapes or forms within it), NEVER a literal location/architecture/landscape/fantasy environment, and NEVER cosmic/nebula/galaxy/energy-swirl/portal imagery (those read as a place or phenomenon, not a flat color); make ${clanAccent || 'deep crimson-red and black'} the dominant rim-light/background color${clanAccent ? ', to keep this clan\'s visual identity consistent across all character portraits' : ', the default mood color for non-vampire characters, to keep visual identity consistent across all character portraits'}
- Block 3: end with exactly this style/quality phrasing, then the resolution — hyperrealistic cinematic portrait photography, fashion-editorial color grading, sharp fine detail on skin texture and fabric, natural human skin, subtle gothic noir atmosphere, Vampire the Masquerade aesthetic, high-end editorial photography quality, masterpiece, 1023x1537. Do NOT use "digital painting", "oil-paint effect", "visible brushstrokes", "concept art" or "artstation" — the target look is a graded photograph, not an illustration or painting.
- Negative prompt: digital painting, illustration, oil painting, visible brushstrokes, concept art, 3D render, CGI, anime, cartoon, blurry, low quality, deformed, cracked skin, marble skin, stone texture skin, nebula background, galaxy background, cosmic energy background, swirling portal background, blood, gore, wounds, injuries, violence
- NO blood, wounds, gore, violence in positive prompt under any circumstances`;

      let positive = '', negative = '';

      const parseResult = (text) => {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Модель не вернула JSON с промтом.');
        const parsed = JSON.parse(match[0]);
        positive = (parsed.positive || '').trim();
        negative = (parsed.negative || '').trim();
      };

      if (isOA(gen)) {
        const modelsToTry = oaModels(gen);
        let lastErr, allRateLimited = true;
        for (const m of modelsToTry) {
          try {
            // Free OpenRouter routing often lands on reasoning models that burn most of the
            // budget on chain-of-thought before any content — give it enough headroom to finish.
            parseResult(await oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 2500));
            allRateLimited = false;
            break;
          } catch (e) {
            lastErr = e;
            const is429 = e.status === 429;
            const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
              || (e.status === 403 && /moderation|flagged/i.test(e.message));
            if (!retryable) { allRateLimited = false; throw e; }
            if (!is429) allRateLimited = false;
            console.warn(`[generate-prompt] model ${m} unavailable (${e.status}), trying next...`);
            if (is429) await new Promise(r => setTimeout(r, 800));
          }
        }
        if (!positive) {
          if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
          throw lastErr;
        }
      } else {
        const model = validModels().includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
        const message = await callAnthropicWithRetry(gen.client, {
          model, max_tokens: 600, system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }, { label: 'generate-prompt' });
        parseResult(message.content[0]?.text?.trim() || '');
      }

      if (!positive) return res.status(500).json({ error: 'Модель не вернула промт. Попробуйте ещё раз.' });

      res.json({ ok: true, positive, negative, source: gen.source });
    } catch (e) {
      const status = e?.status ?? 500;
      const msg    = e?.error?.error?.message ?? e?.message ?? String(e);
      console.error(`[generate-prompt] ${status}`, msg);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, ...(e.rateLimited ? { rateLimited: true } : {}) });
    }
  });

  // ── Generate personality + voice from appearance & biography ──────────────────
  router.post('/api/characters/:slug/generate-personality', aiRateLimit, express.json(), async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const appearance = char.appearance && !char.appearance.includes('⚠️') ? char.appearance.trim() : '';
      const biography   = char.biography  && !char.biography.includes('⚠️')  ? char.biography.trim()  : '';
      if (!appearance && !biography)
        return res.status(400).json({ error: 'Заполните «Внешность» или «Биография» перед генерацией' });

      const infoLines          = charInfoLines(char);
      const existingPersonality = char.personality && !char.personality.includes('⚠️') ? char.personality.trim() : '';
      const existingVoice       = char.voice       && !char.voice.includes('⚠️')       ? char.voice.trim()       : '';

      const preferSource = req.body?.preferSource || null;
      const orModel      = req.body?.orModel      || null;
      const gen = await makeGenerationClient(preferSource, orModel);

      const [litStyle, diaryStyle] = await Promise.all([loadLiteraryStyle(), loadDiaryStyleRules()]);
      const systemPrompt = `Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade. Пиши строго по литературному стилю проекта.${litStyle ? `\n\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}` : ''}${diaryStyle ? `\n\n# КЛАНОВЫЕ СТИЛИ И ТРЕБОВАНИЯ К ПРОЗЕ (diary_rules.md)\n${diaryStyle}` : ''}`;
      const userPrompt = `Персонаж: ${char.name}${infoLines ? `\n\nИнформация:\n${infoLines}` : ''}${appearance ? `\n\nВнешность:\n${appearance}` : ''}${biography ? `\n\nБиография:\n${biography}` : ''}${existingPersonality ? `\n\nЧерновик «Характер» (написан пользователем — возможно общими фразами; используй как базу, но уточни и конкретизируй на основе данных выше, не противоречь им):\n${existingPersonality}` : ''}${existingVoice ? `\n\nЧерновик «Голос» (аналогично — база для уточнения, не финальный текст):\n${existingVoice}` : ''}

На основе этих данных опиши характер и голос персонажа.

Требования:
- «Характер»: 2–4 предложения — ключевые черты, мотивации, манера держаться с другими, внутренние противоречия. Без «воды», без пересказа биографии.
- «Голос»: 1–2 предложения — манера речи, тембр, характерные обороты/интонации, темп.
- Если выше есть черновики «Характер»/«Голос» — не отбрасывай их и не противоречь им, но обязательно конкретизируй и привяжи к фактам персонажа (информация/биография/внешность), чтобы итоговый текст не расходился с карточкой и персонаж читался однозначно.
- Если черновика нет — выводи строго из информации/биографии/внешности, не придумывай факты, которых там нет.
- Язык: русский. Стиль: лаконичный, образный, готический.

Выведи СТРОГО JSON, без лишнего текста:
{"personality": "...", "voice": "..."}`;

      let personality = '', voice = '';
      const parseResult = (text) => {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Модель не вернула JSON с характером.');
        const parsed = JSON.parse(match[0]);
        personality = (parsed.personality || '').trim();
        voice       = (parsed.voice || '').trim();
      };

      if (isOA(gen)) {
        const modelsToTry = oaModels(gen);
        let lastErr, allRateLimited = true;
        for (const m of modelsToTry) {
          try {
            parseResult(await oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 1200));
            allRateLimited = false;
            break;
          } catch (e) {
            lastErr = e;
            const is429 = e.status === 429;
            const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
              || (e.status === 403 && /moderation|flagged/i.test(e.message));
            if (!retryable) { allRateLimited = false; throw e; }
            if (!is429) allRateLimited = false;
            console.warn(`[generate-personality] model ${m} unavailable (${e.status}), trying next...`);
            if (is429) await new Promise(r => setTimeout(r, 800));
          }
        }
        if (!personality) {
          if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
          throw lastErr;
        }
      } else {
        const model = validModels().includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
        const message = await callAnthropicWithRetry(gen.client, {
          model, max_tokens: 500, system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }, { label: 'generate-personality' });
        parseResult(message.content[0]?.text?.trim() || '');
      }

      if (!personality) return res.status(500).json({ error: 'Модель не вернула характер. Попробуйте ещё раз.' });

      res.json({ ok: true, personality, voice, source: gen.source });
    } catch (e) {
      const status = e?.status ?? 500;
      const msg    = e?.error?.error?.message ?? e?.message ?? String(e);
      console.error(`[generate-personality] ${status}`, msg);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, ...(e.rateLimited ? { rateLimited: true } : {}) });
    }
  });

  // ── Generate biography from info fields, appearance & relationships ────────────
  router.post('/api/characters/:slug/generate-biography', aiRateLimit, express.json(), async (req, res) => {
    try {
      const slug = decodeURIComponent(req.params.slug);
      const city = reqCity(req);
      const chars = await getAllCharacters(city);
      const char  = chars.find(c => c.slug === slug);
      if (!char) return res.status(404).json({ error: 'Персонаж не найден' });

      const infoLines    = charInfoLines(char);
      const relLines      = charRelationshipLines(char);
      const appearance    = char.appearance && !char.appearance.includes('⚠️') ? char.appearance.trim() : '';
      const existingBio   = char.biography  && !char.biography.includes('⚠️')  ? char.biography.trim()  : '';
      if (!infoLines && !appearance && !existingBio)
        return res.status(400).json({ error: 'Заполните вкладку «Информация» (или «Внешность»/«Биография») перед генерацией' });

      const preferSource = req.body?.preferSource || null;
      const orModel      = req.body?.orModel      || null;
      const gen = await makeGenerationClient(preferSource, orModel);

      const [litStyle, diaryStyle] = await Promise.all([loadLiteraryStyle(), loadDiaryStyleRules()]);
      const systemPrompt = `Ты — редактор персонажных карточек для настольной RPG Vampire: The Masquerade. Пиши строго по литературному стилю проекта.${litStyle ? `\n\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}` : ''}${diaryStyle ? `\n\n# КЛАНОВЫЕ СТИЛИ И ТРЕБОВАНИЯ К ПРОЗЕ (diary_rules.md)\n${diaryStyle}` : ''}`;
      const userPrompt = `Персонаж: ${char.name}${infoLines ? `\n\nИнформация:\n${infoLines}` : ''}${appearance ? `\n\nВнешность:\n${appearance}` : ''}${relLines ? `\n\nОтношения (обязательно явно отразить смысл КАЖДОЙ связи в тексте биографии — например, родственные/опекунские связи, союзы, конфликты):\n${relLines}` : ''}${existingBio ? `\n\nЧерновик биографии (написан пользователем — используй как базу, дополни и углуби, не противоречь заданной канве):\n${existingBio}` : ''}

Напиши биографию персонажа для карточки.

Требования:
- 4–8 предложений, лаконично, без «воды»
- Обязательно согласуй с данными выше (клан/секта/поколение/роль/локация и т.п.) — никаких противоречий с карточкой
- Если указаны отношения — явно отрази смысл каждого из них в тексте (не просто упомяни имя, а скажи, кем этот персонаж приходится — родственником, союзником, противником и т.д.)
- Если есть черновик биографии — сохрани заданную пользователем канву, дополни и углуби её, не противоречь
- Если черновика нет — выводи строго из информации/внешности/отношений, не придумывай факты, которых там нет
- Язык: русский. Стиль: лаконичный, образный, готический.
- Запрет: не упоминать кровь, раны, увечья, явные сцены насилия

Выведи ТОЛЬКО текст биографии — без заголовков, без кавычек, без JSON.`;

      let biography = '';
      if (isOA(gen)) {
        const modelsToTry = oaModels(gen);
        let lastErr, allRateLimited = true;
        for (const m of modelsToTry) {
          try {
            biography = (await oaCall(gen)(m, systemPrompt, userPrompt, [], 75000, 700)).trim();
            allRateLimited = false;
            break;
          } catch (e) {
            lastErr = e;
            const is429 = e.status === 429;
            const retryable = e.status === 404 || e.status === 502 || is429 || (e.status === 400 && /not a valid model|No endpoints/i.test(e.message))
              || (e.status === 403 && /moderation|flagged/i.test(e.message));
            if (!retryable) { allRateLimited = false; throw e; }
            if (!is429) allRateLimited = false;
            console.warn(`[generate-biography] model ${m} unavailable (${e.status}), trying next...`);
            if (is429) await new Promise(r => setTimeout(r, 800));
          }
        }
        if (!biography) {
          if (allRateLimited) return res.status(429).json({ rateLimited: true, error: 'Превышен лимит запросов ко всем моделям. Подождите минуту и попробуйте снова.' });
          throw lastErr;
        }
      } else {
        const model = validModels().includes(req.body?.model) ? req.body.model : 'claude-haiku-4-5-20251001';
        const message = await callAnthropicWithRetry(gen.client, {
          model, max_tokens: 600, system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }, { label: 'generate-biography' });
        biography = message.content[0]?.text?.trim() || '';
      }

      if (!biography) return res.status(500).json({ error: 'Модель не вернула биографию. Попробуйте ещё раз.' });

      res.json({ ok: true, biography, source: gen.source });
    } catch (e) {
      const status = e?.status ?? 500;
      const msg    = e?.error?.error?.message ?? e?.message ?? String(e);
      console.error(`[generate-biography] ${status}`, msg);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, ...(e.rateLimited ? { rateLimited: true } : {}) });
    }
  });

  // ── AI Director: propose next scene ──────────────────────────────────────────
  // POST /api/director/propose
  // Body: { city, chronicle } OR { state: <Scene State JSON> }
  // Returns scene proposals, NPC suggestions, tension forecast.
  // Human-in-the-loop: the Director PROPOSES, the Storyteller DECIDES.
  router.post('/api/director/propose', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      let state  = req.body?.state || null;

      // If no state provided, build from chronicle events.md
      if (!state && req.body?.chronicle) {
        const evPath = path.join(chroniclesDir(city), req.body.chronicle, 'events.md');
        const raw    = await fs.readFile(evPath, 'utf-8').catch(() => null);
        if (raw) {
          state = compressChronicleEvents(parseEventsText(raw));
          state.city      = city;
          state.chronicle = req.body.chronicle;
        }
      }
      if (!state) return res.status(400).json({ error: 'Нет данных: передай state или chronicle.' });

      const tension  = state.tension || 0;
      const chars    = Object.keys(state.characters || {});
      const flags    = Object.keys(state.world_flags || {});

      const PHASES = [
        { max: 3,  type: 'setup',    goal: 'ввести трение' },
        { max: 6,  type: 'conflict', goal: 'эскалировать конфликт' },
        { max: 10, type: 'climax',   goal: 'вынудить необратимое решение' },
      ];
      const phase = PHASES.find(p => tension <= p.max) || PHASES.at(-1);

      const warnings = [];
      if (tension >= 9) warnings.push('перегрузка напряжения — следующая сцена должна дать разрядку или кризис');
      if (chars.length < 2) warnings.push('меньше 2 активных персонажей — добавь антагониста или свидетеля');
      const deadNames = chars.filter(n => state.characters[n]?.status === 'dead');
      if (deadNames.length) warnings.push(`мёртвые персонажи упомянуты как активные: ${deadNames.join(', ')}`);

      const suggestedScenes = [
        {
          title: phase.type === 'climax' ? 'Кульминация' : 'Следующая сцена',
          goal: phase.goal,
          recommended_characters: chars.slice(0, 3),
          tension_after: Math.min(10, tension + (phase.type === 'climax' ? 2 : 1)),
        }
      ];
      if (flags.length) {
        suggestedScenes.push({
          title: 'Развитие открытой нити',
          hook: flags[0],
          goal: 'развить последствия предыдущего события',
          recommended_characters: chars.slice(0, 2),
          tension_after: tension,
        });
      }

      res.json({
        ok: true,
        meta: {
          ai_suggestion: true,
          user_can_modify: true,
          user_can_reject: true,
          note: 'Рассказчик принимает решение; Director только предлагает.'
        },
        phase:            phase.type,
        phase_goal:       phase.goal,
        tension_now:      tension,
        tension_forecast: Math.min(10, tension + 1),
        active_characters: chars,
        world_flags:      flags,
        suggested_scenes: suggestedScenes,
        warnings,
      });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── OpenRouter / OpenAI prose generation ──────────────────────────────────────
  router.post('/api/openrouter/generate-prose', aiRateLimit, express.json(), async (req, res) => {
    try {
      const stubs      = Array.isArray(req.body.stubs) ? req.body.stubs : [];
      const proseModel = req.body?.model || null;
      if (!stubs.length) return res.status(400).json({ ok: false, error: 'Не переданы stub-файлы.' });

      const city  = reqCity(req);
      const valid = [];
      for (const rel of stubs) {
        const abs = path.resolve(ROOT, rel);
        if (!abs.startsWith(ROOT + path.sep)) continue;
        const txt = await fs.readFile(abs, 'utf-8').catch(() => null);
        if (txt && /ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt)) valid.push(rel);
      }
      if (!valid.length) return res.status(400).json({ ok: false, error: 'Нет stub-файлов с меткой «ОЖИДАЕТ ГЕНЕРАЦИИ».' });

      const { diaryRules, litStyle, stubContents, charCards, eventsChunks } = await buildProseContext(city, valid);

      const systemPrompt = `Ты — Рассказчик Vampire: The Masquerade V20. Пишешь литературные дневниковые записи персонажей строго по правилам ниже.
${litStyle ? `\n# ЛИТЕРАТУРНЫЙ СТИЛЬ (system/rules/literary_style.md)\n${litStyle}\n` : ''}
# ПРАВИЛА ДНЕВНИКОВ
${diaryRules.slice(0, 4000)}

# КАРТОЧКИ ПЕРСОНАЖЕЙ
${charCards.join('\n\n') || '(не найдены)'}

# СОБЫТИЯ ХРОНИКИ (ИСТОЧНИК ФАКТОВ)
${eventsChunks.join('\n\n') || '(не найдены)'}`;

      const userPrompt = `Заполни следующие stub-файлы дневниковой прозой. Строго следуй правилам diary_rules.md.

Для КАЖДОГО файла выведи ТОЧНО в таком формате (без отклонений):
===FILE: <путь к файлу>===
<полное содержимое файла — убери маркер «ОЖИДАЕТ ГЕНЕРАЦИИ» и служебные комментарии>
===ENDFILE===

STUB-ФАЙЛЫ:
${stubContents.map(s => `\n---\n## ${s.rel}\n${s.txt}`).join('\n')}`;

      // Provider: OpenRouter (default) or OpenAI/GPT — both OpenAI-compatible
      const useOpenAI = req.body?.source === 'openai' || req.body?.source === 'gpt';
      if (useOpenAI && !process.env.OPENAI_API_KEY)
        return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY не задан. Настрой в Инструменты → Модели AI.' });
      if (!useOpenAI && !process.env.OPENROUTER_API_KEY)
        return res.status(503).json({ ok: false, error: 'OPENROUTER_API_KEY не задан. Настрой в Инструменты → Модели AI.' });

      const model = proseModel || (useOpenAI
        ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
        : (process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free'));

      let text = '';
      try {
        text = useOpenAI
          ? await callOpenAI(model, systemPrompt, userPrompt, [], 240000, 4000)
          : await callOpenRouter(model, systemPrompt, userPrompt, [], 240000, 4000);
      } catch (e) {
        return res.status(e.status >= 400 && e.status < 600 ? e.status : 500).json({ ok: false, error: e.message });
      }
      if (!text) return res.status(500).json({ ok: false, error: `${useOpenAI ? 'OpenAI' : 'OpenRouter'} вернул пустой ответ.` });

      // Parse ===FILE: ...=== blocks
      const fileBlockRe = /===FILE:\s*(.+?)===\n([\s\S]*?)===ENDFILE===/g;
      let match;
      const written = [], failed = [];

      while ((match = fileBlockRe.exec(text)) !== null) {
        const relPath = match[1].trim();
        const content = match[2].trim();
        const abs     = path.resolve(ROOT, relPath);
        if (!abs.startsWith(ROOT + path.sep)) { failed.push(relPath); continue; }
        try {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await writeFileAtomic(abs, content + '\n', 'utf-8');
          written.push(relPath);
        } catch (e) {
          failed.push(relPath);
        }
      }

      // Check stubs still have marker (= not written)
      const pending = [];
      for (const rel of valid) {
        if (!written.includes(rel)) {
          const txt = await fs.readFile(path.resolve(ROOT, rel), 'utf-8').catch(() => '');
          if (/ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt)) pending.push(rel);
        }
      }

      if (!written.length) {
        console.error('[openrouter-prose] Parse failed. Raw response:\n', text.slice(0, 500));
        return res.status(500).json({ ok: false, error: 'Не удалось разобрать ответ. Проверь формат.', raw: text.slice(0, 800) });
      }

      invalidateChars();
      console.log(`[openrouter-prose] written: ${written.join(', ')}`);
      res.json({ ok: true, written, pending, failed, model });
    } catch (e) {
      console.error('[openrouter-prose]', e.message);
      serverError(res, e);
    }
  });

  // ── Claude CLI prose generation ───────────────────────────────────────────────
  router.post('/api/claude/generate-prose', aiRateLimit, async (req, res) => {
    try {
      const stubs = Array.isArray(req.body.stubs) ? req.body.stubs : [];
      if (!stubs.length) return res.status(400).json({ ok: false, error: 'Не переданы stub-файлы.' });

      // Validate: inside project, exist, and actually carry the pending marker
      const valid = [];
      for (const rel of stubs) {
        const abs = path.resolve(ROOT, rel);
        if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) continue;
        const txt = await fs.readFile(abs, 'utf-8').catch(() => null);
        if (txt && /ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt)) valid.push(rel);
      }
      if (!valid.length)
        return res.status(400).json({ ok: false, error: 'Нет валидных stub-файлов (метка «ОЖИДАЕТ ГЕНЕРАЦИИ» не найдена).' });

      const prompt = [
        'Ты — Рассказчик Vampire: The Masquerade V20, проект «твой домен».',
        'Сгенерируй литературную прозу для следующих stub-файлов (помечены «⏳ ОЖИДАЕТ ГЕНЕРАЦИИ»):',
        ...valid.map(s => '- ' + s),
        '',
        'Правила:',
        '0. Литературный стиль — строго по system/rules/literary_style.md (тон, ритм, диалоги, антишаблоны, голоса персонажей). Применяется ко всей прозе.',
        '1. Дневники — строго по system/rules/diary_rules.md: глубокий POV, клановый стиль автора (сверяйся с карточкой в cities/<город>/characters/), Маскарад через метафоры, 150–400 слов. Заполни поля «📖 Текст записи» и «🔗 Зеркальная ссылка».',
        '2. Файл finale.md — литературный текст финальной сцены сессии.',
        '3. Факты бери ТОЛЬКО из записи хроники, указанной в комментарии «ФАКТЫ» внутри файла (chronicles/<хроника>/events.md). Не выдумывай события и участников.',
        '4. Учти «КОММЕНТАРИЙ МАСТЕРА» (HTML-комментарий) при генерации, затем УДАЛИ все служебные комментарии <!-- ... --> и метки «⏳ ОЖИДАЕТ ГЕНЕРАЦИИ».',
        '5. Меняй ТОЛЬКО перечисленные выше файлы. Больше ничего не трогай.',
        '',
        'В конце кратко перечисли, что записал в каждый файл.'
      ].join('\n');

      const model = req.body.model || defaultClaudeModel();
      const result = await runClaude(prompt, { budget: 2, timeoutMs: 240000, model });

      // Verify the marker is gone in each file
      const written = [], pending = [];
      for (const rel of valid) {
        const txt = await fs.readFile(path.resolve(ROOT, rel), 'utf-8').catch(() => '');
        (/ОЖИДАЕТ ГЕНЕРАЦИИ/.test(txt) ? pending : written).push(rel);
      }
      invalidateChars();

      res.json({
        ok: !result.is_error && written.length > 0,
        written, pending,
        cost: result.total_cost_usd ?? null,
        durationMs: result.duration_ms ?? null,
        summary: result.result || ''
      });
    } catch (e) {
      serverError(res, e);
    }
  });

  // ── OpenRouter: list free models ──────────────────────────────────────────────
  let _orModelsCache = null;
  let _orModelsCacheAt = 0;
  const OR_MODELS_TTL = 30 * 60 * 1000; // 30 min

  router.get('/api/openrouter/models', async (req, res) => {
    if (_orModelsCache && (Date.now() - _orModelsCacheAt) < OR_MODELS_TTL) {
      return res.json({ ok: true, models: _orModelsCache });
    }
    try {
      const apiKey  = process.env.OPENROUTER_API_KEY;
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const resp = await fetch('https://openrouter.ai/api/v1/models', { headers });
      if (!resp.ok) throw new Error(`OpenRouter API: ${resp.status}`);
      const data = await resp.json();
      const free = (data.data || [])
        .filter(m => {
          const p = m.pricing || {};
          if ((String(p.prompt) !== '0') || (String(p.completion) !== '0')) return false;
          // Exclude image-generation models — they return content:null + images:[],
          // not text, so they break every text-generation endpoint.
          const outModes = m.architecture?.output_modalities;
          if (outModes?.length && !outModes.includes('text')) return false;
          return true;
        })
        .map(m => ({ id: m.id, label: m.name || m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
      free.push({ id: 'openrouter/free', label: 'Free Models Router' });
      _orModelsCache = free;
      _orModelsCacheAt = Date.now();
      res.json({ ok: true, models: free });
    } catch (e) {
      console.error('[or-models]', e.message);
      const fallback = [
        { id: 'google/gemma-4-26b-a4b-it:free',         label: 'Google Gemma 4 26B (Vision)' },
        { id: 'nvidia/nemotron-nano-12b-v2-vl:free',     label: 'Nvidia Nemotron Nano 12B VL' },
        { id: 'moonshotai/kimi-k2.6:free',               label: 'Moonshot Kimi K2.6' },
        { id: 'meta-llama/llama-4-scout:free',           label: 'Meta Llama 4 Scout' },
        { id: 'microsoft/mai-ds-r1:free',                label: 'Microsoft MAI DS R1' },
        { id: 'openrouter/free',                         label: 'Free Models Router' },
      ];
      res.json({ ok: true, models: fallback, fromFallback: true });
    }
  });

  // ── Canon consistency check (AI) — flags contradictions in a logged event ──────
  router.post('/api/canon-check', aiRateLimit, express.json(), async (req, res) => {
    try {
      const city = reqCity(req);
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'Пустой текст для проверки' });
      if (text.length > 8000) return res.status(400).json({ ok: false, error: 'Слишком длинный текст (макс ~8000 символов)' });

      const chars = await getAllCharacters(city);
      const facts = chars.map(c => {
        const st = (c.status && !/⚠️/.test(c.status)) ? c.status
                 : (c.statusDetails && !/⚠️/.test(c.statusDetails) ? c.statusDetails : (c.statusType || '—'));
        const bits = [
          c.clan && !/⚠️/.test(c.clan) ? c.clan : null,
          c.embraceYear && !/⚠️|не указан/i.test(c.embraceYear) ? `обращён ${c.embraceYear}` : null,
          (c.hierarchy && !/⚠️/.test(c.hierarchy)) ? c.hierarchy : ((c.role && !/⚠️/.test(c.role)) ? c.role : null),
        ].filter(Boolean).join('; ');
        return `- ${c.name} [${c.lineage}] — статус: ${st}${bits ? ` — ${bits}` : ''}`;
      }).join('\n');

      const gen = await makeGenerationClient(req.body?.source || null, req.body?.model || null);
      const systemPrompt = `Ты — проверяющий непротиворечивость канона в Vampire: The Masquerade V20.
Тебе дают ТЕКСТ логируемого события (сцена/сессия) и УСТАНОВЛЕННЫЕ ФАКТЫ о персонажах города.
Найди ПРОТИВОРЕЧИЯ между фактами и текстом. Типы:
- уничтоженный / в финальной смерти / в торпоре персонаж действует как живой активный участник;
- участие до обращения или до прибытия в город (несовместимость дат);
- статус/должность не соответствует (назван должностью, которой ещё или уже не имеет);
- персонаж одновременно в двух местах / там, где быть не мог по фактам.

ОСОБО проверяй ДАТЫ. Найди в тексте дату/год и сравни с датами в фактах:
- участие РАНЬШЕ года обращения персонажа — противоречие;
- должность с пометкой «с <месяц год>»: если дата текста РАНЬШЕ этой даты — персонаж ещё НЕ занимал должность, называть его так нельзя (противоречие);
- статус «Уничтожен (<дата>)»: действие ПОСЛЕ даты уничтожения — противоречие.
Пример: факт «Шериф (с ноября 2010)»; текст «декабрь 2009 … Шериф такой-то» → противоречие: в 2009 он ещё не Шериф.

Сообщай ТОЛЬКО реальные противоречия с фактами. Догадки и стилистику не трогай. Если противоречий нет — пустой массив.

# УСТАНОВЛЕННЫЕ ФАКТЫ (источник истины)
${facts.slice(0, 7000)}`;

      const userPrompt = `ТЕКСТ СОБЫТИЯ:
${text}

Верни СТРОГО JSON-массив без текста вне JSON:
[{"severity":"high|medium|low","character":"<имя>","issue":"<что не сходится с фактом>","quote":"<короткая цитата из текста>"}]
Если противоречий нет — верни [].`;

      let raw = '';
      if (isOA(gen)) {
        raw = await oaCall(gen)(gen.model, systemPrompt, userPrompt, [], 75000, 1500);
      } else {
        const m = await callAnthropicWithRetry(gen.client, {
          model: gen.model, max_tokens: 1500, system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }, { label: 'canon-check' });
        raw = m.content[0]?.text?.trim() || '';
      }
      let issues = [];
      try { issues = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch {}
      if (!Array.isArray(issues)) issues = [];
      res.json({ ok: true, issues, checked: chars.length });
    } catch (e) {
      const status = e.status ?? 500;
      res.status(status >= 400 && status < 600 ? status : 500).json({ ok: false, error: e.message ?? String(e), ...(e.rateLimited ? { rateLimited: true } : {}) });
    }
  });

  return router;
};
