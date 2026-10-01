/*
 * Records documentary scenes frame by frame.
 *
 *   node documentary/record.mjs A B C ...
 *
 * Needs the game's Vite dev server (npm run dev, or: OFFLINE_FONTS=1 npx vite --port 4176) and Chromium
 * from Playwright. For every scene: a fresh browser, shim.js before any game code, the director module,
 * then step the virtual clock 1/FPS at a time and pipe each captured frame to ffmpeg. When the scene
 * ends, the game's own soundtrack is rendered offline and cut to the frames.
 *
 * Output (documentary/out/<scene>/): video.mp4 (no sound), audio.wav, meta.json (event log).
 * The player's progress (localStorage) carries from one scene to the next through out/state.json.
 *
 * Environment:
 *   DOC_URL   game URL               (default http://localhost:4176/)
 *   DOC_W/H   viewport               (default 1280x720)
 *   DOC_FPS   frames per second      (default 30)
 *   DOC_DRY=1 no video: a still every DOC_STILL seconds to out-dry/<scene>/, rendering skipped in between
 *   DOC_CHROME path to chrome        (default /opt/pw-browsers/chromium)
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, writeSync, closeSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const URL = process.env.DOC_URL || 'http://localhost:4176/';
const W = +(process.env.DOC_W || 1280), H = +(process.env.DOC_H || 720), FPS = +(process.env.DOC_FPS || 30);
const DRY = process.env.DOC_DRY === '1', STILL = +(process.env.DOC_STILL || 2);
const OUT = join(here, DRY ? 'out-dry' : 'out');
const SEEDS = { A: 11, B: 23, C: 37, D: 41, E: 53, F: 67, G: 79 };
const AUDIO_SECONDS = { A: 150, B: 130, C: 130, D: 90, E: 60, F: 90, G: 120 };
const SETTINGS = { quality: 'high', dynRes: false, hints: false, fps: false, mixV3: true };

const scenes = process.argv.slice(2);
if (!scenes.length) { console.log('usage: node documentary/record.mjs A B C ...'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const statePath = join(OUT, 'state.json');
const shim = readFileSync(join(here, 'shim.js'), 'utf8');

function ffmpeg(args) {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['pipe', 'inherit', 'inherit'] });
  p.done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  return p;
}
const write = (stream, buf) => new Promise((res) => { if (stream.write(buf)) res(); else stream.once('drain', res); });

async function record(id) {
  const dir = join(OUT, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const t0 = Date.now();
  const proxy = process.env.HTTPS_PROXY ? ['--proxy-server=https=' + process.env.HTTPS_PROXY.replace(/^https?:\/\//, '')] : [];
  const browser = await playwright.chromium.launch({
    executablePath: process.env.DOC_CHROME || '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required', ...proxy],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log(`[${id}] pageerror`, e.message); });
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[doc]') || m.type() === 'error') console.log(`[${id}]`, t); });
  const cfg = { seed: SEEDS[id] || 1, audioSeconds: AUDIO_SECONDS[id] || 120, dry: DRY };
  await page.addInitScript(([cfg, state, settings]) => {
    window.__docCfg = cfg;
    try {
      for (const [k, v] of Object.entries(state)) localStorage.setItem(k, v);
      localStorage.setItem('ghasaq.settings.v2', JSON.stringify(settings));
    } catch { /* storage unavailable */ }
  }, [cfg, state, SETTINGS]);
  await page.addInitScript({ content: shim });
  await page.goto(URL + '#doc', { waitUntil: 'domcontentloaded' });
  // a fresh URL every take: the server never re-reads a module it has already served
  await page.addScriptTag({ type: 'module', url: `/documentary/director.js?take=${Date.now()}` });
  await page.waitForFunction(() => window.__doc && window.__doc.run, null, { timeout: 120000 });
  await page.evaluate((id) => window.__doc.run(id), id);
  const cdp = await ctx.newCDPSession(page);

  const enc = DRY ? null : ffmpeg(['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), join(dir, 'video.mp4')]);
  const dt = 1000 / FPS;
  let frames = 0, steps = 0, firstT = null, lastLog = Date.now(), wasRec = false;
  const stillEvery = Math.round(STILL * FPS);
  for (;;) {
    const still = DRY && wasRec && frames % stillEvery === 0;
    const st = await page.evaluate(async ([dt, still]) => {
      if (window.__doc.still) window.__doc.still(still);
      await window.__vt.step(dt);
      return { rec: window.__doc.rec, done: window.__doc.done, t: window.__vt.t };
    }, [dt, still && true]);
    steps++;
    wasRec = st.rec;
    if (st.rec) {
      if (firstT === null) firstT = st.t;
      if (DRY) {
        if (still) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
          writeFileSync(join(dir, `t${String(Math.round(frames / FPS)).padStart(3, '0')}.jpg`), Buffer.from(shot.data, 'base64'));
        }
      } else {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95 });
        await write(enc.stdin, Buffer.from(shot.data, 'base64'));
      }
      frames++;
    }
    if (st.done) break;
    if (Date.now() - lastLog > 60000) {
      lastLog = Date.now();
      console.log(`[${id}] ${(frames / FPS).toFixed(1)} s recorded, ${((Date.now() - t0) / 60000).toFixed(1)} min elapsed`);
    }
    if (steps > FPS * 600) { console.log(`[${id}] giving up: no end after 10 minutes of game time`); break; }
  }
  if (enc) { enc.stdin.end(); await enc.done; }
  const seconds = frames / FPS;
  console.log(`[${id}] ${frames} frames (${seconds.toFixed(1)} s) in ${((Date.now() - t0) / 60000).toFixed(1)} min; rendering audio...`);

  // the soundtrack, from the first recorded frame, as long as the picture
  const audio = await page.evaluate(() => window.__vt.audio ? window.__vt.audio._t0 : null);
  if (audio !== null && firstT !== null && !DRY) {
    const ta = Date.now();
    await page.evaluate(() => window.__vt.renderAudio());
    const from = (firstT - audio) / 1000;
    const raw = join(dir, 'audio.f32');
    const fd = openSync(raw, 'w');
    for (let s = 0; s < seconds; s += 5) {
      const b64 = await page.evaluate(([a, n]) => window.__vt.audioChunk(a, n), [from + s, Math.min(5, seconds - s)]);
      writeSync(fd, Buffer.from(b64, 'base64'));
    }
    closeSync(fd);
    await ffmpeg(['-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', raw, '-c:a', 'pcm_f32le', join(dir, 'audio.wav')]).done;
    rmSync(raw);
    console.log(`[${id}] audio ${seconds.toFixed(1)} s from +${from.toFixed(2)} s, rendered in ${((Date.now() - ta) / 60000).toFixed(1)} min`);
  }
  const doc = await page.evaluate(() => ({ log: window.__doc.log, error: window.__doc.error || null }));
  const saved = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ghasaq') && k !== 'ghasaq.settings.v2').map((k) => [k, localStorage.getItem(k)])));
  writeFileSync(statePath, JSON.stringify(saved, null, 1));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ scene: id, frames, fps: FPS, seconds, width: W, height: H, errors, ...doc, minutes: (Date.now() - t0) / 60000 }, null, 1));
  await browser.close();
  console.log(`[${id}] done in ${((Date.now() - t0) / 60000).toFixed(1)} min${doc.error ? ' WITH ERROR ' + doc.error : ''}`);
}

for (const id of scenes) await record(id);
