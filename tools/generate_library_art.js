'use strict';
// Батч-генерация иллюстраций карточек библиотеки через локальный ComfyUI.
// Использование: node tools/generate_library_art.js [--only=slug1,slug2] [--force]

const fs   = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const COMFY_HOST = 'http://127.0.0.1:8188';
// Git-установка ComfyUI (D:\ComfyUI, venv) — прежняя portable-версия удалена.
const COMFY_DIR  = process.env.COMFY_DIR || 'D:\\ComfyUI';
// Чекпоинт из models/checkpoints (подпапки — через '\\', как отдаёт /object_info).
const COMFY_CKPT = process.env.COMFY_CKPT || 'Illustrious\\base model\\illustriousRealism_ilXL10V40.safetensors';
// Размер генерации. SDXL/Illustrious обучены на ~1024×1024: ниже ~768 модель
// заметно «разваливает» композицию (каша, дубли), поэтому по умолчанию генерим
// 1024 и уменьшаем до 400 при сохранении. COMFY_SIZE=768 — компромисс скорости.
const COMFY_SIZE = parseInt(process.env.COMFY_SIZE, 10) || 1024;
const ROOT       = path.join(__dirname, '..');
const MANIFEST   = require('./library-art-manifest.json');
const { compressPngViaSquoosh } = require('./lib/squoosh_compress');

// Сюжет — первым и с весом: в середине длинного промта он проигрывает
// «эмблемным» токенам, и модель рисует пустой орнамент с полумесяцем.
const POSITIVE_TMPL = scene => "(" + scene + ":1.35), "
  + "solid pure black background, jet black background filling the entire square canvas, "
  + "dark gothic emblem, circular ornate medallion badge floating on black, "
  + "engraved etching illustration style, "
  + "deep crimson and black color palette, dark iron and muted aged metals, "
  + "the whole composition enclosed in an ornate blackened dark iron filigree square border frame "
  + "with decorated corners, dark aged metal frame, fine filigree linework, no bright gold frame, "
  + "symmetrical heraldic composition, high contrast chiaroscuro lighting, Vampire the Masquerade aesthetic, "
  + "dark fantasy tarot card icon, intricate line detail, painterly digital illustration, centered composition, "
  + "single subject, masterpiece, highly detailed, sharp focus, "
  + "background is solid black all the way to every corner and edge of the frame, no white anywhere in the background";

const NEGATIVE = "photo, photorealistic, human face, person, portrait of a person, low quality, blurry, "
  + "castle, cathedral, palace, building, architecture, "
  + "bright gold, golden ornament, gilded decoration, shiny gold metal, "
  + "nude, naked, nsfw, bare skin, kissing, romantic scene, "
  + "watermark, text, signature, cropped, extra limbs, deformed, asymmetrical, modern cartoon, anime chibi, "
  + "3d render, plastic, multiple subjects, collage, border cropped, jpeg artifacts, "
  + "beige background, tan background, cream background, white background, light background, parchment, paper texture, "
  + "grey background, gray background, silver background, light grey corners, washed out background, faded background, "
  + "white corners, white edges, white canvas, ivory background, bone white background, pale background, "
  + "vignette fade to white, gradient to white, off-white background";

function buildWorkflow(scene, filenamePrefix) {
  return {
    "3": { "class_type": "KSampler", "inputs": {
      "seed": Math.floor(Math.random() * 1e9), "steps": 32, "cfg": 6.5,
      "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0,
      "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
    }},
    "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": COMFY_CKPT } },
    "5": { "class_type": "EmptyLatentImage", "inputs": { "width": COMFY_SIZE, "height": COMFY_SIZE, "batch_size": 1 } },
    "6": { "class_type": "CLIPTextEncode", "inputs": { "text": POSITIVE_TMPL(scene), "clip": ["4", 1] } },
    "7": { "class_type": "CLIPTextEncode", "inputs": { "text": NEGATIVE, "clip": ["4", 1] } },
    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
    "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": filenamePrefix, "images": ["8", 0] } }
  };
}

async function isComfyUp() {
  try {
    const r = await fetch(COMFY_HOST + '/system_stats', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function ensureComfyRunning() {
  if (await isComfyUp()) return;
  console.log('ComfyUI not running — starting it...');
  const proc = spawn(
    path.join(COMFY_DIR, 'venv', 'Scripts', 'python.exe'),
    ['main.py'],
    { cwd: COMFY_DIR, detached: true, stdio: 'ignore' }
  );
  proc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    if (await isComfyUp()) { console.log('ComfyUI ready.'); return; }
  }
  throw new Error('ComfyUI did not become ready within 60s');
}

async function generateOne(entry) {
  const clientId = 'sanguine-libart-' + Date.now();
  const workflow = buildWorkflow(entry.scene, 'sanguine_' + entry.slug);
  const res = await fetch(COMFY_HOST + '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  });
  const data = await res.json();
  if (data.error) throw new Error('ComfyUI queue error: ' + JSON.stringify(data.error));
  const promptId = data.prompt_id;

  // До ~9 минут на картинку: первая генерация включает загрузку SDXL-модели
  // в VRAM (RTX 3050), это заметно дольше самого сэмплинга.
  for (let i = 0; i < 360; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const hRes = await fetch(COMFY_HOST + '/history/' + promptId);
    const hData = await hRes.json();
    const entryHist = hData[promptId];
    if (entryHist && entryHist.status && entryHist.status.completed) {
      const img = entryHist.outputs['9'].images[0];
      return path.join(COMFY_DIR, 'output', img.filename);
    }
    if (entryHist && entryHist.status && entryHist.status.status_str === 'error') {
      throw new Error('Generation error: ' + JSON.stringify(entryHist.status));
    }
  }
  throw new Error('Timeout waiting for ComfyUI generation: ' + entry.slug);
}

function resizeTo400(srcPath, dstPath) {
  const script = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("${srcPath.replace(/\\/g, '\\\\')}")
$dst = New-Object System.Drawing.Bitmap 400,400
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.DrawImage($src, 0, 0, 400, 400)

$dst.Save("${dstPath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $dst.Dispose(); $src.Dispose()
`.trim();
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', script]);
  if (r.status !== 0) throw new Error('PowerShell resize failed: ' + r.stderr.toString());
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.find(a => a.startsWith('--only'));
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;

  await ensureComfyRunning();

  for (const entry of MANIFEST) {
    if (only && !only.includes(entry.slug)) continue;
    // Готовые PNG кладём прямо в web/public/img/system/library/<раздел>/ —
    // эта папка уже раздаётся статикой (express.static на web/public), новый
    // роут не нужен.
    const destDir = path.join(ROOT, 'web', 'public', 'img', 'system', 'library', entry.section);
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, entry.slug + '.png');
    if (fs.existsSync(destPath) && !force) {
      console.log('skip (exists):', entry.slug);
      continue;
    }
    console.log('generating:', entry.slug, '...');
    // Ошибка одной картинки не должна ронять весь батч (79+ записей за прогон):
    // логируем и идём дальше, недостающие добираются повторным запуском.
    try {
      const outputPath = await generateOne(entry);
      resizeTo400(outputPath, destPath);
      console.log('saved:', destPath);
    } catch (e) {
      console.error('  FAILED:', entry.slug, '-', e.message);
      continue;
    }

    try {
      const { originalSize, compressedSize } = await compressPngViaSquoosh(destPath);
      const pct = Math.round((1 - compressedSize / originalSize) * 100);
      console.log(`  squoosh: ${originalSize} -> ${compressedSize} bytes (-${pct}%)`);
    } catch (e) {
      console.warn('  squoosh compress failed, keeping uncompressed PNG:', e.message);
    }
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
