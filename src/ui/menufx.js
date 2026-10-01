import { isTouch, reduceMotion } from '../config/settings.js';

/*
 * Embers and drifting dust over the menu backdrop: a 2D canvas under the menus and over the
 * 3D view. It only runs while a menu that wants it is open, and stops completely in play.
 *   'title' - boot and splash: dense embers rising from the bottom
 *   'menu'  - main menu: fewer embers, a little dust
 *   'page'  - full pages: a faint dust drift
 *   'off'   - nothing (play, pause)
 */

const DENSITY = { title: 1, menu: 0.7, page: 0.3, off: 0 };
const MAX = isTouch ? 70 : 120;
const cv = document.getElementById('menuFx');
const ctx = cv ? cv.getContext('2d') : null;
let mode = 'off', running = false, last = 0, W = 1, H = 1, scale = 1;
const parts = [];

// one pre-rendered glow sprite, tinted per particle through globalAlpha
const sprite = document.createElement('canvas');
sprite.width = sprite.height = 32;
{
  const g = sprite.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,236,200,1)');
  r.addColorStop(0.18, 'rgba(255,170,90,.9)');
  r.addColorStop(0.45, 'rgba(255,110,40,.25)');
  r.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
}

const rnd = (a, b) => a + Math.random() * (b - a);
function resize() {
  if (!cv) return;
  scale = Math.min(window.devicePixelRatio || 1, isTouch ? 1 : 1.5);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
}
function spawn(p, anywhere) {
  p.ember = Math.random() < (mode === 'page' ? 0.25 : 0.62);
  p.x = rnd(-0.05, 1.05) * W;
  p.y = anywhere ? rnd(0, 1) * H : H + rnd(4, 40);
  p.vy = p.ember ? -rnd(18, 62) : -rnd(2, 10);
  p.vx = p.ember ? rnd(-10, 14) : rnd(6, 20);
  p.s = p.ember ? rnd(5, 13) : rnd(1, 2.4);
  p.life = p.ember ? rnd(4, 10) : rnd(8, 16);
  p.t = anywhere ? rnd(0, p.life) : 0;
  p.ph = rnd(0, 6.28); p.fl = rnd(3, 9);
}
function frame(now) {
  if (mode === 'off' || !ctx) { running = false; if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); return; }
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  const want = Math.round(MAX * DENSITY[mode]);
  while (parts.length < want) { const p = {}; spawn(p, true); parts.push(p); }
  if (parts.length > want) parts.length = want;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    p.t += dt;
    p.x += (p.vx + Math.sin(p.t * 1.3 + p.ph) * (p.ember ? 14 : 4)) * dt;
    p.y += p.vy * dt;
    if (p.t > p.life || p.y < -30 || p.x > W + 40) { spawn(p, false); continue; }
    const k = p.t / p.life, fade = Math.sin(Math.PI * Math.min(1, k * 1.1));
    if (p.ember) {
      const fl = 0.65 + 0.35 * Math.sin(p.t * p.fl + p.ph);
      ctx.globalAlpha = Math.max(0, fade * fl * (mode === 'page' ? 0.4 : 0.85));
      const s = p.s * (1 - k * 0.5);
      ctx.drawImage(sprite, p.x - s, p.y - s, s * 2, s * 2);
    } else {
      ctx.globalAlpha = Math.max(0, fade * 0.35);
      ctx.fillStyle = '#e8cfa4';
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// scripted screenshots (#autotest-…) run on virtual time, which a busy loading screen would race
const TEST = /autotest/.test(location.hash);
export function setMenuFx(m, boot) {
  if (reduceMotion || !ctx || (boot && TEST)) m = 'off';
  if (m === mode) return;
  mode = m;
  if (mode !== 'off' && !running) {
    running = true;
    resize();
    last = performance.now();
    requestAnimationFrame(frame);
  }
}
addEventListener('resize', resize);
