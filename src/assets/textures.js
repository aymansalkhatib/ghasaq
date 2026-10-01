import * as THREE from 'three';
import { TAU, clamp, mulberry32 } from '../core/utils.js';
import { maxAniso } from '../core/renderer.js';

/* Every texture in the game is painted here in code. buildTextures() fills TEX once at boot. */

export const TEX = {};

function mkCanvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tileNoise(period, seed) {
  const r = mulberry32(seed), g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(w, h, base, oct, seed, gain = 0.5) {
  const out = new Float32Array(w * h), layers = [];
  let norm = 0;
  for (let o = 0; o < oct; o++) { layers.push(tileNoise(base << o, seed + o * 101)); norm += gain ** o; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, amp = 1;
      for (let o = 0; o < oct; o++) { const p = base << o; s += layers[o]((x / w) * p, (y / h) * p) * amp; amp *= gain; }
      out[y * w + x] = s / norm;
    }
  }
  return out;
}
function paint(w, h, fn) {
  const c = mkCanvas(w, h), ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data, px = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      px[3] = 255;
      fn(x, y, y * w + x, px);
      const i = (y * w + x) * 4;
      d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function normalFrom(hf, w, h, strength) {
  return paint(w, h, (x, y, i, px) => {
    const l = hf[y * w + (x - 1 + w) % w], r = hf[y * w + (x + 1) % w];
    const u = hf[((y - 1 + h) % h) * w + x], dn = hf[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    px[0] = (nx * 0.5 + 0.5) * 255; px[1] = (ny * 0.5 + 0.5) * 255; px[2] = (nz * 0.5 + 0.5) * 255;
  });
}
function asTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}
const hexRGB = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
function mixRGB(a, b, t, px) { px[0] = a[0] + (b[0] - a[0]) * t; px[1] = a[1] + (b[1] - a[1]) * t; px[2] = a[2] + (b[2] - a[2]) * t; }
function drawTex(size, fn, srgb = true, h = size) { const c = mkCanvas(size, h), ctx = c.getContext('2d'); fn(ctx, size, h); return asTex(c, srgb, false); }

function sand() {
  const S = 512, n = fbm(S, S, 4, 5, 11), fine = fbm(S, S, 64, 2, 17), hgt = new Float32Array(S * S);
  const rs = mulberry32(3), c1 = hexRGB(0xae8756), c2 = hexRGB(0xdbbd8a);
  TEX.sand = asTex(paint(S, S, (x, y, i, px) => {
    const rip = Math.sin((x / S) * TAU * 14 + n[i] * 10 + (y / S) * TAU * 2) * 0.5 + 0.5;
    hgt[i] = n[i] * 0.7 + rip * 0.14 + fine[i] * 0.2;
    mixRGB(c1, c2, clamp(n[i] * 1.2 - 0.1 + fine[i] * 0.15, 0, 1), px);
    const k = 1 - (1 - rip) * 0.07 - (rs() < 0.004 ? 0.28 : 0);
    px[0] *= k; px[1] *= k; px[2] *= k;
  }));
  TEX.sandN = asTex(normalFrom(hgt, S, S, 4), false);
}
function plaster() {
  const S = 512, n = fbm(S, S, 4, 5, 23), wear = fbm(S, S, 8, 4, 29), streak = tileNoise(64, 31), hgt = new Float32Array(S * S);
  const c1 = hexRGB(0xc9a579), c2 = hexRGB(0xe4c89e), brick = hexRGB(0xb07f55);
  TEX.plaster = asTex(paint(S, S, (x, y, i, px) => {
    const row = Math.floor(y / 32), bx = (x + (row % 2) * 48) % 96, by = y % 32;
    const mortar = Math.min(bx, 96 - bx, by, 32 - by) < 2.5;
    const exposed = wear[i] > 0.62;
    mixRGB(c1, c2, n[i], px);
    if (exposed) { mixRGB(px, brick, 0.35, px); if (mortar) { px[0] *= 0.7; px[1] *= 0.7; px[2] *= 0.7; } }
    const s = streak((x / S) * 64, (y / S) * 4) * 0.12;
    px[0] *= 1 - s; px[1] *= 1 - s; px[2] *= 1 - s;
    hgt[i] = n[i] * 0.6 + (exposed ? (mortar ? -0.4 : 0.1) : 0.3) + wear[i] * 0.2;
  }));
  TEX.plasterN = asTex(normalFrom(hgt, S, S, 3.5), false);
}
function stone() {
  const S = 512, n = fbm(S, S, 8, 4, 41), rr = mulberry32(43), tints = [], hgt = new Float32Array(S * S);
  for (let k = 0; k < 64; k++) tints.push(0.85 + rr() * 0.25);
  const base = hexRGB(0xc7ab82);
  TEX.stone = asTex(paint(S, S, (x, y, i, px) => {
    const row = Math.floor(y / 64), bx = (x + (row % 2) * 64) % 128, by = y % 64;
    const col = Math.floor(((x + (row % 2) * 64) % S) / 128);
    const edge = Math.min(bx, 128 - bx, by, 64 - by);
    const t = tints[(row * 4 + col) % 64] * (0.85 + n[i] * 0.3);
    px[0] = base[0] * t; px[1] = base[1] * t; px[2] = base[2] * t;
    if (edge < 3) { px[0] *= 0.55; px[1] *= 0.55; px[2] *= 0.55; }
    hgt[i] = edge < 3 ? 0 : Math.min(1, edge / 8) * 0.8 + n[i] * 0.3;
  }));
  TEX.stoneN = asTex(normalFrom(hgt, S, S, 3), false);
}
function wood() {
  const S = 512, gn = tileNoise(32, 51), hgt = new Float32Array(S * S);
  const w1 = hexRGB(0x8a6440), w2 = hexRGB(0xb88a58);
  TEX.crate = asTex(paint(S, S, (x, y, i, px) => {
    const frame = x < 44 || x > S - 44 || y < 44 || y > S - 44;
    const diag = !frame && Math.abs(x - y) < 34;
    let along, across, edge;
    if (frame) {
      const vert = (x < 44 || x > S - 44) && y >= 44 && y <= S - 44;
      along = vert ? y : x; across = vert ? x : y;
      edge = vert ? Math.min(Math.abs(x - 44), Math.abs(x - (S - 44)), x, S - x) : Math.min(Math.abs(y - 44), Math.abs(y - (S - 44)), y, S - y);
    } else if (diag) { along = (x + y) * 0.707; across = (x - y) * 0.707; edge = 34 - Math.abs(x - y); }
    else { along = y; across = x; edge = Math.min((x - 44) % 85, 85 - ((x - 44) % 85)); }
    const g = Math.sin(across * 0.9 + gn(along * 0.02, across * 0.08) * 9) * 0.5 + 0.5;
    mixRGB(w1, w2, g * 0.7 + gn(x / 16, y / 16) * 0.3, px);
    let k = frame ? 0.82 : diag ? 0.9 : 1;
    if (edge < 3) k *= 0.55;
    const nx = x < 64 ? x - 22 : S - 22 - x, ny = y < 64 ? y - 22 : S - 22 - y;
    if ((x < 64 || x > S - 64) && (y < 64 || y > S - 64) && nx * nx + ny * ny < 20) k *= 0.35;
    px[0] *= k; px[1] *= k; px[2] *= k;
    hgt[i] = (frame || diag ? 1 : 0.55) - (edge < 3 ? 0.5 : 0) + g * 0.05;
  }));
  TEX.crateN = asTex(normalFrom(hgt, S, S, 2.5), false);
  const p1 = hexRGB(0x6e4a2c), p2 = hexRGB(0x9a6d44);
  TEX.planks = asTex(paint(256, 256, (x, y, i, px) => {
    const g = Math.sin(x * 0.8 + gn(y * 0.03, x * 0.05) * 8) * 0.5 + 0.5;
    mixRGB(p1, p2, g, px);
    if (x % 64 < 2) { px[0] *= 0.5; px[1] *= 0.5; px[2] *= 0.5; }
  }));
}
function barrel(base, hazard) {
  const W = 512, H = 256, n = fbm(W, H, 8, 4, 61), sc = mulberry32(67), b = hexRGB(base), rust = hexRGB(0x6b3a1e);
  const c = paint(W, H, (x, y, i, px) => {
    px[0] = b[0]; px[1] = b[1]; px[2] = b[2];
    const r = n[i] * 0.8 + (y < 18 || y > H - 18 ? 0.3 : 0);
    if (r > 0.62) mixRGB(px, rust, clamp((r - 0.62) * 4, 0, 0.85), px);
    if (Math.abs(y - H * 0.33) < 5 || Math.abs(y - H * 0.66) < 5) { px[0] *= 0.72; px[1] *= 0.72; px[2] *= 0.72; }
    if (hazard && y > H * 0.42 && y < H * 0.58) {
      const hz = Math.floor((x + y) / 22) % 2 === 0 ? [236, 190, 40] : [28, 24, 20];
      px[0] = hz[0]; px[1] = hz[1]; px[2] = hz[2];
      if (r > 0.66) mixRGB(px, rust, 0.4, px);
    }
    const k = 0.9 + n[i] * 0.2; px[0] *= k; px[1] *= k; px[2] *= k;
  });
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(220,210,190,0.18)';
  for (let k = 0; k < 90; k++) { const x = sc() * W, y = sc() * H, l = sc() * 40 + 5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y + l * 0.15); ctx.stroke(); }
  return asTex(c);
}
function camo(cols, seed) {
  const S = 256, n = fbm(S, S, 3, 4, seed), m = fbm(S, S, 5, 3, seed + 7), w = tileNoise(128, seed + 9), c = cols.map(hexRGB);
  return asTex(paint(S, S, (x, y, i, px) => {
    const v = n[i] * 0.6 + m[i] * 0.4;
    const k = v < 0.42 ? 0 : v < 0.52 ? 1 : v < 0.6 ? 2 : 3;
    px[0] = c[k][0]; px[1] = c[k][1]; px[2] = c[k][2];
    const weave = ((x + y) % 4 < 2 ? 0.94 : 1.0) * (0.92 + w(x / 2, y / 2) * 0.16);
    px[0] *= weave; px[1] *= weave; px[2] *= weave;
  }));
}
function fabrics() {
  const wn = tileNoise(64, 101);
  TEX.webbing = asTex(paint(128, 128, (x, y, i, px) => {
    const band = y % 22 < 3 ? 0.62 : 1;
    const weave = (x % 3 === 0 ? 0.9 : 1) * (y % 3 === 0 ? 0.92 : 1) * (0.9 + wn(x / 2, y / 2) * 0.2) * band;
    px[0] = px[1] = px[2] = 215 * weave;
  }));
  const cn = tileNoise(32, 111);
  TEX.cloth = asTex(paint(256, 256, (x, y, i, px) => {
    const a = Math.floor(x / 32) % 2 === 0 ? [176, 64, 42] : [226, 206, 170];
    const k = 0.88 + cn(x / 8, y / 8) * 0.2;
    px[0] = a[0] * k; px[1] = a[1] * k; px[2] = a[2] * k;
  }));
  // parachute canopy: alternating olive and sand gores
  TEX.canopy = asTex(paint(512, 64, (x, y, i, px) => {
    const a = Math.floor(x / 32) % 2 === 0 ? [96, 104, 70] : [196, 176, 132];
    const k = 0.85 + cn(x / 6, y / 6) * 0.2 - (y / 64) * 0.12;
    px[0] = a[0] * k; px[1] = a[1] * k; px[2] = a[2] * k;
  }), true, false);
  TEX.canopy.wrapS = THREE.RepeatWrapping;
  // cargo canopy: high-visibility orange and white gores
  TEX.canopyCargo = asTex(paint(512, 64, (x, y, i, px) => {
    const a = Math.floor(x / 32) % 2 === 0 ? [232, 110, 38] : [238, 232, 220];
    const k = 0.88 + cn(x / 6, y / 6) * 0.16 - (y / 64) * 0.1;
    px[0] = a[0] * k; px[1] = a[1] * k; px[2] = a[2] * k;
  }), true, false);
  TEX.canopyCargo.wrapS = THREE.RepeatWrapping;
}
function leaf() {
  const c = mkCanvas(256, 64), ctx = c.getContext('2d');
  ctx.strokeStyle = '#4f5a26'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(256, 32); ctx.stroke();
  for (let x = 6; x < 250; x += 5) {
    const len = 28 * Math.sin((x / 256) * Math.PI) + 4;
    for (const s of [-1, 1]) {
      ctx.strokeStyle = `hsl(${70 + Math.random() * 18}, ${35 + Math.random() * 15}%, ${22 + Math.random() * 12}%)`;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + len * 0.55, 32 + s * len); ctx.stroke();
    }
  }
  TEX.leaf = asTex(c, true, false);
}
function star5(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.4 : r;
    ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}
function flag() {
  // the flag of Syria: green, white and black bands with three red stars
  const drawSyria = (ctx, W, H) => {
    ctx.fillStyle = '#007a3d'; ctx.fillRect(0, 0, W, H / 3);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, H / 3, W, H / 3);
    ctx.fillStyle = '#000000'; ctx.fillRect(0, (2 * H) / 3, W, H / 3);
    ctx.fillStyle = '#ce1126';
    for (const x of [0.3, 0.5, 0.7]) star5(ctx, W * x, H / 2, H * 0.13);
  };
  TEX.flag = drawTex(300, drawSyria, true, 200);
  TEX.flag.wrapS = TEX.flag.wrapT = THREE.ClampToEdgeWrapping;
  TEX.flagPatch = drawTex(96, (ctx, W, H) => { drawSyria(ctx, W, H); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, W - 2, H - 2); }, true, 64);
  // the invaders wear a fictional emblem: a red spear-head on black
  TEX.enemyPatch = drawTex(96, (ctx, W, H) => {
    ctx.fillStyle = '#141414'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#b3261e';
    ctx.beginPath(); ctx.moveTo(W / 2, H * 0.12); ctx.lineTo(W * 0.66, H * 0.62); ctx.lineTo(W / 2, H * 0.5); ctx.lineTo(W * 0.34, H * 0.62); ctx.closePath(); ctx.fill();
    ctx.fillRect(W * 0.47, H * 0.5, W * 0.06, H * 0.36);
    ctx.strokeStyle = '#b3261e'; ctx.lineWidth = 3; ctx.strokeRect(3, 3, W - 6, H - 6);
  }, true, 64);
  // the invaders' war banner (fictional): the red spear-head on black, between blood-red bands
  TEX.enemyBanner = drawTex(128, (ctx, W, H) => {
    ctx.fillStyle = '#6e1410'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#151313'; ctx.fillRect(W * 0.14, H * 0.05, W * 0.72, H * 0.9);
    ctx.fillStyle = '#b3261e';
    ctx.beginPath(); ctx.moveTo(W / 2, H * 0.14); ctx.lineTo(W * 0.72, H * 0.44); ctx.lineTo(W / 2, H * 0.36); ctx.lineTo(W * 0.28, H * 0.44); ctx.closePath(); ctx.fill();
    ctx.fillRect(W * 0.46, H * 0.36, W * 0.08, H * 0.42);
    ctx.fillRect(W * 0.34, H * 0.74, W * 0.32, H * 0.03);
    for (let k = 0; k < 300; k++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  }, true, 256);
  // stencilled side of the supply crate
  TEX.supplySide = drawTex(256, (ctx, W, H) => {
    ctx.fillStyle = '#4d5433'; ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 400; k++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
    ctx.fillStyle = '#e8c547'; ctx.fillRect(0, H * 0.08, W, H * 0.07); ctx.fillRect(0, H * 0.85, W, H * 0.07);
    ctx.fillStyle = '#efe6c8';
    ctx.font = `700 ${Math.round(H * 0.3)}px Changa, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('إمداد', W / 2, H * 0.47);
    ctx.font = `600 ${Math.round(H * 0.08)}px Oswald, sans-serif`;
    ctx.fillText('↑  ↑  ↑   QR-24 · 1100 KG', W / 2, H * 0.72);
  });
}
function aircraftPanels() {
  const n = tileNoise(64, 131);
  TEX.panels = asTex(paint(256, 256, (x, y, i, px) => {
    let k = 0.86 + n(x / 10, y / 10) * 0.14;
    if (x % 64 < 1 || y % 48 < 1) k *= 0.62;
    if ((x % 64 === 5 || x % 64 === 59) && y % 8 === 0) k *= 0.5;
    px[0] = px[1] = px[2] = 225 * k;
  }));
}
function water() {
  const S = 256, h = fbm(S, S, 8, 4, 141);
  TEX.waterN = asTex(normalFrom(h, S, S, 5), false);
}
function skins() {
  const n = fbm(256, 256, 4, 3, 151), m = tileNoise(32, 157);
  TEX.skinTiger = asTex(paint(256, 256, (x, y, i, px) => {
    const s = Math.sin((x * 0.06 + n[i] * 6 + y * 0.012) * 3.2);
    const base = [196, 146, 78], dark = [38, 30, 24];
    mixRGB(base, dark, s > 0.55 ? 1 : 0, px);
  }));
  TEX.skinNight = asTex(paint(256, 256, (x, y, i, px) => {
    const v = m(Math.floor(x / 8), Math.floor(y / 8));
    const c = v < 0.35 ? [30, 32, 36] : v < 0.65 ? [52, 56, 60] : [78, 82, 88];
    px[0] = c[0]; px[1] = c[1]; px[2] = c[2];
  }));
}
function decals() {
  TEX.hole = drawTex(128, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(10,8,6,1)'); g.addColorStop(0.12, 'rgba(20,16,12,1)'); g.addColorStop(0.22, 'rgba(60,48,36,.85)');
    g.addColorStop(0.5, 'rgba(90,75,58,.35)'); g.addColorStop(1, 'rgba(90,75,58,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(30,24,18,.6)'; ctx.lineWidth = 1.4;
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * TAU, l = S * (0.2 + Math.random() * 0.22);
      ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l); ctx.stroke();
    }
  });
  const bloodCanvas = (seed, S = 256) => {
    const r = mulberry32(seed), c = mkCanvas(S), ctx = c.getContext('2d');
    const blob = (x, y, rad, a) => { ctx.fillStyle = `rgba(${90 + r() * 40},${r() * 8},${r() * 6},${a})`; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill(); };
    for (let k = 0; k < 14; k++) blob(S / 2 + (r() - 0.5) * 60, S / 2 + (r() - 0.5) * 60, 14 + r() * 26, 0.9);
    for (let k = 0; k < 7; k++) {
      const a = r() * TAU;
      let d = 50, rad = 9;
      while (rad > 1.2 && d < S / 2 - 8) { blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, rad, 0.92); d += rad * 1.6 + r() * 6; rad *= 0.72; }
    }
    for (let k = 0; k < 40; k++) blob(S / 2 + (r() - 0.5) * S * 0.85, S / 2 + (r() - 0.5) * S * 0.85, 1 + r() * 3, 0.85);
    return c;
  };
  TEX.blood = [5, 9, 13].map((s) => asTex(bloodCanvas(s), true, false));
  // screen-space splatter images for the HUD
  TEX.bloodScreen = [21, 27, 33, 39].map((s) => bloodCanvas(s, 320).toDataURL('image/png'));
  TEX.pool = drawTex(256, (ctx, S) => {
    for (let k = 0; k < 16; k++) {
      ctx.fillStyle = 'rgba(95,4,3,.95)';
      ctx.beginPath(); ctx.ellipse(S / 2 + (Math.random() - 0.5) * 70, S / 2 + (Math.random() - 0.5) * 70, 30 + Math.random() * 40, 24 + Math.random() * 34, Math.random() * TAU, 0, TAU); ctx.fill();
    }
  });
  TEX.scorch = drawTex(256, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(8,6,5,.95)'); g.addColorStop(0.45, 'rgba(15,12,10,.7)'); g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * TAU, l = S * (0.3 + Math.random() * 0.2);
      ctx.strokeStyle = 'rgba(10,8,6,.35)'; ctx.lineWidth = 3 + Math.random() * 5;
      ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l); ctx.stroke();
    }
  });
  TEX.ring = drawTex(128, (ctx, S) => {
    ctx.strokeStyle = 'rgba(255,60,40,1)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.4, 0, TAU); ctx.stroke();
    ctx.lineWidth = 3;
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(S / 2 + Math.cos(a) * S * 0.22, S / 2 + Math.sin(a) * S * 0.22); ctx.lineTo(S / 2 + Math.cos(a) * S * 0.34, S / 2 + Math.sin(a) * S * 0.34); ctx.stroke(); }
  });
}
function sprites() {
  TEX.flash = drawTex(128, (ctx, S) => {
    ctx.translate(S / 2, S / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
    g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.2, 'rgba(255,200,120,.9)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    for (let k = 0; k < 7; k++) {
      ctx.rotate(TAU / 7 + Math.random() * 0.3);
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, S * (0.3 + Math.random() * 0.2)); ctx.lineTo(5, 0); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, 0, S * 0.16, 0, TAU); ctx.fill();
  });
  TEX.soft = drawTex(64, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  });
  TEX.glint = drawTex(128, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, 'rgba(255,250,235,.9)'); g.addColorStop(0.3, 'rgba(255,230,190,.2)'); g.addColorStop(1, 'rgba(255,220,180,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,248,230,.85)';
    ctx.fillRect(0, S / 2 - 1.5, S, 3); ctx.fillRect(S / 2 - 1.5, 0, 3, S);
  });
  TEX.reddot = drawTex(64, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 5);
    g.addColorStop(0, 'rgba(255,60,40,1)'); g.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(255,60,40,.8)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, 14, 0, TAU); ctx.stroke();
  });
  // holographic reticle: a 65 MOA ring with four short ticks round a 1 MOA dot (ring radius = 40 of 64)
  TEX.holo = drawTex(128, (ctx, S) => {
    const c = S / 2;
    // the ring and ticks are thin and faint so a target inside them stays clear
    ctx.strokeStyle = 'rgba(255,90,70,.45)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(c, c, 40, 0, TAU); ctx.stroke();
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, x = Math.cos(a), y = Math.sin(a);
      ctx.beginPath(); ctx.moveTo(c + x * 42, c + y * 42); ctx.lineTo(c + x * 50, c + y * 50); ctx.stroke();
    }
    ctx.shadowColor = 'rgba(255,70,50,.9)'; ctx.shadowBlur = 4; ctx.fillStyle = 'rgba(255,120,95,1)';
    ctx.beginPath(); ctx.arc(c, c, 3.6, 0, TAU); ctx.fill();
  });
  // reflex sight: a single 2 MOA dot with a soft bloom (dot radius = 5 of 32)
  TEX.reflex = drawTex(64, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,150,120,1)'); g.addColorStop(0.16, 'rgba(255,60,40,1)'); g.addColorStop(0.24, 'rgba(255,40,25,.35)'); g.addColorStop(1, 'rgba(255,30,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  });
  TEX.rotor = drawTex(256, (ctx, S) => {
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(20,20,20,0)'); g.addColorStop(0.2, 'rgba(20,20,22,.35)'); g.addColorStop(0.95, 'rgba(20,20,22,.28)'); g.addColorStop(1, 'rgba(20,20,22,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  });
}

export function buildTextures() {
  sand(); plaster(); stone(); wood(); fabrics(); leaf(); flag(); aircraftPanels(); water(); skins(); decals(); sprites();
  TEX.barrelRed = barrel(0xa5261c, true);
  TEX.barrelOlive = barrel(0x4d5436, false);
  TEX.barrelBlue = barrel(0x2b4a6e, false);
  TEX.camoDesert = camo([0x7d6749, 0x9f8761, 0x5f4e39, 0xbca47a], 71);
  TEX.camoNight = camo([0x3d423c, 0x51564c, 0x2b2e2b, 0x62665b], 83);
  TEX.camoHeavy = camo([0x2a2d30, 0x34383b, 0x222427, 0x3d4145], 97);
  TEX.camoAlly = camo([0x8a8660, 0x6b6a48, 0xa99f78, 0x55563c], 211);
}
