/*
 * The director: loaded into the running game by record.mjs (after shim.js has taken over the clocks).
 * It imports the game's own modules, so everything on screen is the real game: the director only
 * plays it (an autopilot drives the same input state as the keyboard and mouse), moves a cinematic
 * camera for the establishing shots, and lays Arabic titles and captions over the picture.
 *
 *   __doc.run(sceneId)  starts a scene. The recorder captures frames while __doc.rec is true and
 *                       stops when __doc.done is true. Events are logged to __doc.log.
 */
import * as THREE from 'three';
import { game, run, enemies, allies, refs, parachutes, pickups } from '/src/core/state.js';
import { camera, composer, vmScene, scene, keyLight, applyQuality } from '/src/core/renderer.js';
import { QUALITY, settings } from '/src/config/settings.js';
import { applyTOD, tod } from '/src/core/sky.js';
import { wrapAngle, clamp, smooth, lerp } from '/src/core/utils.js';
import { input } from '/src/input/input.js';
import { player } from '/src/entities/player.js';
import { spawnEnemy } from '/src/entities/enemy.js';
import { Ally } from '/src/entities/ally.js';
import { losBlocked } from '/src/entities/combat.js';
import { buildSoldier, animateSoldier } from '/src/entities/soldier-model.js';
import { startRun, startWave } from '/src/systems/waves.js';
import { callSupport, confirmStrike, support } from '/src/systems/support.js';
import { useNearest } from '/src/systems/pickups.js';
import { focus, setFocus } from '/src/systems/focus.js';
import { Helicopter, spawnHelicopter } from '/src/vehicles/helicopter.js';
import { buildTransport, buildJet, buildHeli, buildUAV } from '/src/vehicles/models.js';
import { showScreen, clearShowcase, switchMap } from '/src/ui/screens.js';
import { initAudio } from '/src/audio/engine.js';
import { music } from '/src/audio/music.js';
import { sfx } from '/src/audio/sfx.js';
import { weaponState, inv, currentKey, currentWeapon, startReload, switchSlot } from '/src/weapons/arsenal.js';
import { nadeDown, nadeUp } from '/src/weapons/grenades.js';
import { setStorm } from '/src/fx/weather.js';
import { WEAPONS } from '/src/config/balance.js';

const VT = window.__vt;

// film quality: full resolution with bloom and 2048 shadows, no MSAA (software rendering cost doubles with it)
Object.assign(QUALITY.high, { pr: 1, shadow: 2048, bloom: true, samples: 0, particles: 1 });
settings.quality = 'high'; settings.grain = false; settings.dynRes = false; settings.hints = false; settings.fps = false;
applyQuality();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const now = () => VT.t / 1000;
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const rnd = (a, b) => a + Math.random() * (b - a);
const $ = (id) => document.getElementById(id);
const until = async (fn, max = 30) => { const t0 = now(); while (!fn() && now() - t0 < max) await wait(1 / 30); return fn(); };

const doc = (window.__doc = { rec: false, done: false, log: [], scene: '', dry: !!(window.__docCfg && window.__docCfg.dry) });
function log(...a) {
  const line = `${now().toFixed(2)} ${a.join(' ')}`;
  doc.log.push(line);
  console.log('[doc]', line);
}
const hooks = [];
VT.hooks.push((dt) => { for (const h of hooks.slice()) h(dt); });

/* =====================================================================================
 * Overlay: titles, chapter cards, captions, a stats card and a pointer for the menus
 * ===================================================================================== */
const CSS = `
#doc{position:fixed;inset:0;z-index:300;pointer-events:none;direction:rtl;color:#f5ede0;font-family:"IBM Plex Sans Arabic","Changa",sans-serif}
#doc .black{position:absolute;inset:0;background:#000;opacity:0}
#doc .card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0}
#doc .card .eb{display:inline-flex;align-items:center;gap:12px;font:600 17px Changa,sans-serif;color:#ffb36b}
#doc .card .eb:before,#doc .card .eb:after{content:"";width:34px;height:1.5px;background:linear-gradient(90deg,transparent,#ff8a3d)}
#doc .card .eb:after{transform:scaleX(-1)}
#doc .card .logo{font-size:150px;line-height:1.32;padding:0 24px;margin:-14px 0 -22px}
#doc .card .sub{font:500 21px/1.7 "IBM Plex Sans Arabic",sans-serif;color:#e9dcc6;max-width:820px;margin:0}
#doc .card .sub+.sub{margin-top:2px;color:#b9ab94;font-size:18px}
#doc .chap{background:radial-gradient(70% 46% at 50% 50%,rgba(6,5,4,.66),rgba(6,5,4,.25) 60%,transparent 80%)}
#doc .chap .n{font:600 16px Changa,sans-serif;color:#ffb36b;display:inline-flex;align-items:center;gap:12px}
#doc .chap .n:before,#doc .chap .n:after{content:"";width:46px;height:1.5px;background:linear-gradient(90deg,transparent,#ff8a3d)}
#doc .chap .n:after{transform:scaleX(-1)}
#doc .chap .t{font:800 66px/1.15 Changa,sans-serif;color:#fff3e2;text-shadow:0 6px 34px rgba(0,0,0,.75);margin:4px 0 2px}
#doc .chap .s{font:500 18px "IBM Plex Sans Arabic",sans-serif;color:#dccdb5;text-shadow:0 2px 12px rgba(0,0,0,.8)}
#doc .cap{position:absolute;max-width:440px;padding:13px 18px 14px;opacity:0;background:linear-gradient(270deg,rgba(11,9,8,.9),rgba(11,9,8,.72));border-inline-start:3px solid #ff8a3d;box-shadow:0 12px 34px rgba(0,0,0,.4)}
#doc .cap b{display:block;font:700 13px Changa,sans-serif;color:#ffb36b;margin-bottom:3px}
#doc .cap p{margin:0;font:500 17.5px/1.7 "IBM Plex Sans Arabic",sans-serif;color:#f5ede0}
#doc .cap.left{left:30px;top:250px}
#doc .cap.leftlow{left:30px;bottom:150px}
#doc .cap.right{right:30px;top:150px}
#doc .cap.topleft{left:30px;top:96px}
#doc .cap.top{left:300px;top:14px;max-width:640px;padding:10px 18px 11px}
#doc .cap.bottomc{left:50%;bottom:64px;margin-left:-210px;width:460px;max-width:460px}
#doc .stats{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;background:rgba(6,5,4,.62)}
#doc .stats h4{margin:0 0 22px;font:800 34px Changa,sans-serif;color:#fff3e2}
#doc .stats .g{display:grid;grid-template-columns:repeat(3,230px);gap:14px}
#doc .stats .c{padding:16px 18px;background:rgba(18,14,11,.85);box-shadow:inset 0 0 0 1px rgba(255,228,190,.14);text-align:right}
#doc .stats .c b{display:block;font:600 40px/1.1 Oswald,Changa,sans-serif;color:#ffb36b}
#doc .stats .c span{font:500 14px "IBM Plex Sans Arabic",sans-serif;color:#d5c8b3}
#doc .stats .tech{margin-top:20px;font:500 16px "IBM Plex Sans Arabic",sans-serif;color:#b9ab94;direction:ltr}
#doc .ptr{position:absolute;left:0;top:0;width:26px;height:26px;opacity:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
#doc .ring{position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid #ffb36b;border-radius:50%;opacity:0}
`;
const root = document.createElement('div');
root.id = 'doc';
root.innerHTML = `<style>${CSS}</style><div class="black"></div>
<svg class="ptr" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.6 15 L18.5 15 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><div class="ring"></div>`;
document.body.appendChild(root);
const blackEl = root.querySelector('.black'), ptrEl = root.querySelector('.ptr'), ringEl = root.querySelector('.ring');

/** Fades: every overlay element animates from the virtual clock (no CSS timing involved). */
const fades = new Set();
function fade(el, { inAt = now(), dur = 4, fin = 0.7, fout = 0.7, dy = 10, max = 1, remove = true } = {}) {
  const f = { el, inAt, outAt: inAt + dur, fin, fout, dy, max, remove };
  fades.add(f);
  return f;
}
hooks.push(() => {
  const t = now();
  for (const f of fades) {
    let o = 0, y = 0;
    if (t >= f.inAt) {
      const a = smooth(clamp((t - f.inAt) / f.fin, 0, 1)), b = f.outAt == null ? 1 : smooth(clamp((f.outAt - t) / f.fout, 0, 1));
      o = Math.min(a, b) * f.max;
      y = (1 - a) * f.dy - (1 - b) * f.dy * 0.6;
    }
    f.el.style.opacity = o.toFixed(3);
    f.el.style.transform = `translateY(${y.toFixed(1)}px)`;
    if (f.outAt != null && t > f.outAt + 0.05) { fades.delete(f); if (f.remove) f.el.remove(); }
  }
});
let blackTarget = 0, blackSpeed = 1;
hooks.push((dt) => {
  const o = parseFloat(blackEl.style.opacity || '0');
  const n = o + clamp(blackTarget - o, -dt / blackSpeed, dt / blackSpeed);
  blackEl.style.opacity = n.toFixed(3);
});
/** Fade to (1) or from (0) black over `s` seconds. */
const black = (to, s = 0.6) => { blackTarget = to; blackSpeed = Math.max(0.01, s); if (s <= 0.01) blackEl.style.opacity = String(to); };

function add(html, cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  root.insertBefore(d, ptrEl);
  return d;
}
function caption(text, { pos = 'left', tag = '', dur = 6 } = {}) {
  log('caption', pos, text.slice(0, 40));
  return fade(add(`${tag ? `<b>${tag}</b>` : ''}<p>${text}</p>`, `cap ${pos}`), { dur, fin: 0.6, fout: 0.6, dy: 12 });
}
function chapter(n, title, sub, dur = 4.2) {
  log('chapter', title);
  return fade(add(`<span class="n">${n}</span><span class="t">${title}</span><span class="s">${sub}</span>`, 'card chap'), { dur, fin: 0.9, fout: 0.9, dy: 14 });
}

/* ---------- a mouse pointer for the menus ---------- */
const ptr = { x: 640, y: 420, vis: 0, tv: 0, from: null, to: null, t0: 0, dur: 1 };
hooks.push((dt) => {
  if (ptr.to) {
    const k = smooth(clamp((now() - ptr.t0) / ptr.dur, 0, 1));
    ptr.x = lerp(ptr.from.x, ptr.to.x, k); ptr.y = lerp(ptr.from.y, ptr.to.y, k);
    if (k >= 1) ptr.to = null;
  }
  ptr.vis += clamp(ptr.tv - ptr.vis, -dt * 4, dt * 4);
  ptrEl.style.opacity = ptr.vis.toFixed(3);
  ptrEl.style.transform = `translate(${(ptr.x - 3).toFixed(1)}px,${(ptr.y - 2).toFixed(1)}px)`;
});
function pointTo(x, y, dur = 0.8) { ptr.from = { x: ptr.x, y: ptr.y }; ptr.to = { x, y }; ptr.t0 = now(); ptr.dur = dur; ptr.tv = 1; return wait(dur); }
function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55 }; }
async function hover(sel, dur = 0.8) {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) { log('missing', sel); return null; }
  const r = el.getBoundingClientRect();
  if (r.bottom > innerHeight - 90 || r.top < 0) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); await wait(0.25); }
  const c = centerOf(el);
  await pointTo(c.x, c.y, dur);
  el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  return el;
}
async function click(sel, dur = 0.8) {
  const el = await hover(sel, dur);
  if (!el) return;
  await wait(0.18);
  const ring = ringEl;
  ring.style.left = ptr.x + 'px'; ring.style.top = ptr.y + 'px';
  fade(ring, { dur: 0.25, fin: 0.05, fout: 0.25, dy: 0, max: 0.9, remove: false });
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  el.click();
  log('click', typeof sel === 'string' ? sel : el.className);
  await wait(0.25);
}

/* =====================================================================================
 * Cinematic camera: overrides the game camera right before each render
 * ===================================================================================== */
const cine = { fn: null, t0: 0, thinFog: 1, hideHud: true, wide: false };
const _look = new THREE.Vector3();
const render0 = composer.render.bind(composer);
let stillFrame = false;
composer.render = (...a) => {
  if (doc.dry && !stillFrame) { scene.updateMatrixWorld(); camera.updateMatrixWorld(); return; }
  if (!cine.fn) return render0(...a);
  const s = cine.fn(now() - cine.t0);
  camera.clearViewOffset();
  camera.position.copy(s.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(s.look);
  if (s.roll) camera.rotateZ(s.roll);
  camera.fov = s.fov || 50;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const vm = vmScene.visible; vmScene.visible = false;
  const fog = scene.fog.density; scene.fog.density = fog * (s.fog ?? cine.thinFog);
  const sc = keyLight.shadow.camera, saved = [sc.left, sc.right, sc.top, sc.bottom];
  const R = s.shadow || 42;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.updateProjectionMatrix();
  _look.copy(s.shadowAt || s.look); _look.y = 0;
  keyLight.target.position.copy(_look); keyLight.position.copy(_look).addScaledVector(tod.keyDir, 120);
  keyLight.target.updateMatrixWorld(); keyLight.updateMatrixWorld();
  render0(...a);
  scene.fog.density = fog;
  vmScene.visible = vm;
  [sc.left, sc.right, sc.top, sc.bottom] = saved; sc.updateProjectionMatrix();
};
function shot(fn, opts = {}) {
  cine.fn = fn; cine.t0 = now(); cine.thinFog = opts.thinFog ?? 1; cine.hideHud = opts.hideHud ?? true;
  for (const id of ['hud', 'radio', 'hint']) if ($(id)) $(id).style.visibility = cine.hideHud ? 'hidden' : '';
}
const endShot = () => { cine.fn = null; for (const id of ['hud', 'radio', 'hint']) if ($(id)) $(id).style.visibility = ''; };
/** A slow orbit: centre c, radius r, height h, start angle a0, angular speed w (rad/s). */
const orbit = (c, r, h, a0, w, lookY = 0, fov = 42) => (t) => {
  const a = a0 + w * t;
  return { pos: V(c.x + Math.sin(a) * r, h, c.z + Math.cos(a) * r), look: V(c.x, lookY, c.z), fov, shadow: 60, shadowAt: c };
};
/** A straight dolly from p0 to p1 over dur seconds, looking from l0 to l1. */
const dolly = (p0, p1, l0, l1, dur, fov = 50) => (t) => {
  const k = smooth(clamp(t / dur, 0, 1));
  return { pos: p0.clone().lerp(p1, k), look: l0.clone().lerp(l1, k), fov };
};

/* =====================================================================================
 * Autopilot: aims, fires in bursts, strafes, reloads, uses the scope
 * ===================================================================================== */
const bot = {
  on: false, anchor: V(0, 0, 0), roam: 2, target: null, pickT: 0, react: 0, burst: 0, rest: 0, semiT: 0,
  look: null, heli: false, move: null, strafe: 0, strafeT: 1, range: 70, head: 0.4, aimRate: 7, crouch: false, hold: false,
};
const _a = new THREE.Vector3();
function chest(e, out = _a) {
  const head = e._docHead ?? (e._docHead = Math.random() < bot.head);
  return out.set(e.pos.x, e.pos.y + (e.crouch ? (head ? 1.12 : 0.85) : head ? 1.6 : 1.28), e.pos.z);
}
function aimAt(p, dt, rate = bot.aimRate) {
  const c = camera.position, dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
  const yawT = Math.atan2(-dx, -dz), pitchT = Math.atan2(dy, Math.hypot(dx, dz));
  const ey = wrapAngle(yawT - (player.yaw + player.recoilY)), ep = pitchT - (player.pitch + player.recoilP);
  const k = 1 - Math.exp(-rate * dt), mx = 3.4 * dt;
  player.yaw += clamp(ey * k, -mx, mx);
  player.pitch = clamp(player.pitch + clamp(ep * k, -mx, mx), -1.35, 1.35);
  return Math.hypot(ey, ep);
}
function pickTarget() {
  let best = null, bs = Infinity;
  const fwd = _b.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  for (const e of enemies) {
    if (!e.alive) continue;
    const p = chest(e, _c), d = p.distanceTo(camera.position);
    if (d > bot.range) continue;
    if (losBlocked(camera.position, p)) continue;
    const dir = _d.copy(p).sub(camera.position).setY(0).normalize();
    const ang = Math.acos(clamp(dir.dot(fwd), -1, 1));
    const s = d * 0.5 + ang * 22 + (e === bot.target ? -10 : 0);
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}
const _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
function nearestEnemy() {
  let best = null, bd = Infinity;
  for (const e of enemies) { if (!e.alive) continue; const d = e.pos.distanceTo(player.pos); if (d < bd) { bd = d; best = e; } }
  return best;
}
hooks.push((dt) => {
  if (!bot.on || game.state !== 'playing' || !player.alive) return;
  const W = currentWeapon(), A = inv.ammo[currentKey()];
  if (A && A.res < 60) A.res = 90;
  // movement: scripted move, or a little strafing around the anchor
  let mx = 0, my = 0;
  const goal = bot.move || (Math.hypot(player.pos.x - bot.anchor.x, player.pos.z - bot.anchor.z) > bot.roam ? bot.anchor : null);
  if (goal) {
    const gx = goal.x - player.pos.x, gz = goal.z - player.pos.z, gd = Math.hypot(gx, gz);
    if (gd > 0.35) {
      const f = [-Math.sin(player.yaw), -Math.cos(player.yaw)], r = [Math.cos(player.yaw), -Math.sin(player.yaw)];
      const sp = bot.move ? 1 : 0.6;
      mx = ((gx * r[0] + gz * r[1]) / gd) * sp; my = ((gx * f[0] + gz * f[1]) / gd) * sp;
    } else if (bot.move) { bot.move = null; log('arrived'); }
  } else if (!bot.hold) {
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafe = [-1, 0, 0, 1][Math.floor(Math.random() * 4)] * 0.7; bot.strafeT = rnd(0.6, 1.6); }
    mx = bot.strafe;
  }
  input.stickX = mx; input.stickY = my;
  input.crouch = bot.crouch;
  input.sprint = !!bot.move && !bot.target;

  // looking and shooting
  bot.pickT -= dt;
  if (bot.pickT <= 0) {
    bot.pickT = 0.25;
    const t = bot.look || bot.heli ? null : pickTarget();
    if (t !== bot.target) { bot.target = t; bot.react = rnd(0.25, 0.5); }
  }
  let fire = false, aim = false;
  if (bot.look) {
    const p = typeof bot.look === 'function' ? bot.look() : bot.look;
    if (p) aimAt(p, dt, bot.aimRate * 0.7);
  } else if (bot.heli && refs.heli && refs.heli.state !== 'dead' && refs.heli.state !== 'crash') {
    const h = refs.heli.g.position;
    const err = aimAt(_e.set(h.x, h.y - 0.4, h.z), dt, 6);
    aim = true;
    if (err < 0.05) fire = burst(dt, W);
  } else if (bot.target && bot.target.alive) {
    const p = chest(bot.target, _e);
    const d = p.distanceTo(camera.position);
    // a little hand drift so the aim never looks robotic
    p.x += Math.sin(now() * 1.7) * 0.05; p.y += Math.sin(now() * 2.3 + 1) * 0.04;
    const err = aimAt(p, dt);
    aim = d > 9 || W.sight === 'scope';
    bot.react -= dt;
    const tol = Math.max(0.012, 0.6 / d);
    if (bot.react <= 0 && err < tol && (W.sight !== 'scope' || weaponState.ads > 0.9)) fire = burst(dt, W);
  } else {
    // nothing in sight: watch the way the nearest raider will come
    const e = nearestEnemy();
    if (e) aimAt(_e.set(e.pos.x, e.pos.y + 1.4, e.pos.z), dt, 2.5);
    if (A && A.mag < W.mag * 0.35 && A.res > 0) startReload();
  }
  input.fire = fire;
  input.aim = aim;
});
function burst(dt, W) {
  if (!W.auto) {
    bot.semiT -= dt;
    if (bot.semiT <= 0) { bot.semiT = W.sight === 'scope' ? rnd(0.75, 1.1) : rnd(0.28, 0.45); return true; }
    return false;
  }
  if (bot.burst > 0) { bot.burst -= dt; return true; }
  bot.rest -= dt;
  if (bot.rest <= 0) { bot.burst = rnd(0.2, 0.45); bot.rest = rnd(0.25, 0.55); }
  return false;
}
function botOn(anchor, opts = {}) {
  Object.assign(bot, { on: true, anchor: anchor.clone(), roam: 2, look: null, heli: false, move: null, hold: false, crouch: false, head: 0.4 }, opts);
}
function botOff() { bot.on = false; input.fire = input.aim = false; input.stickX = input.stickY = 0; input.crouch = input.sprint = false; }
async function throwNade(at) {
  bot.look = () => at.clone().setY(at.y + at.distanceTo(player.pos) * 0.28);
  await wait(0.6);
  nadeDown();
  await wait(0.7);
  nadeUp();
  log('grenade');
  await wait(0.8);
  bot.look = null;
}

/* =====================================================================================
 * Shared set-up
 * ===================================================================================== */
// the documentary keeps the player standing (the autopilot is filmed, not graded): incoming damage is
// cut and health never drops into the low-health effects; squad mates are tougher too
const hurt0 = player.hurt;
player.hurt = function (dmg, ...rest) {
  hurt0.call(this, dmg * doc.dmg, ...rest);
  if (this.hp < 58) this.hp = 58;
};
doc.dmg = 0.3;
const allyHurt = Ally.prototype.hurt;
Ally.prototype.hurt = function (dmg) { return allyHurt.call(this, dmg * 0.35); };
const heliHit = Helicopter.prototype.hit;
doc.heliMul = 1;
Helicopter.prototype.hit = function (dmg, point) { return heliHit.call(this, dmg * doc.heliMul, point); };

function audioOn() { if (initAudio()) { sfx.initAmbience(); music.init(); } }
async function booted() {
  await until(() => game.state === 'splash', 120);
  await wait(0.5);
}
/** Start a battle like the deploy button does, then move to the wave and hour the scene needs. */
function battle({ map = 'citadel', wave = 0, hour = null, primary = 'rifle', skin = 'std', at = null, yaw = null, sp = 3000, spawn = true }) {
  audioOn();
  startRun({ map, mode: 'dusk', diff: 'veteran', primary, skin });
  showScreen(null);
  clearShowcase();
  // the sandstorm comes only where a scene asks for it
  game.stormWave = -1; setStorm(false); game.storm = 0;
  if (wave) startWave(wave);
  // no fight: one raider stays 'due' but never comes, so the wave neither spawns anyone nor ends
  if (!spawn) { game.toSpawn = 1; game.spawnT = 1e9; game.snipersDue = []; }
  game.heliDue = -1;
  if (hour != null) { game.hour = hour; applyTOD(hour); }
  if (at) player.pos.copy(at);
  if (yaw != null) player.yaw = yaw;
  player.pitch = -0.03;
  run.sp = sp;
  log('battle', map, 'wave', wave, 'hour', hour);
}
/** Keep the wave going for the length of a shot: more raiders due, a few at a time, through the wave's own spawner. */
function keepComing(due = 12, alive = 5) { game.toSpawn = Math.max(game.toSpawn, due); game.maxAlive = alive; game.spawnT = Math.min(game.spawnT, 1); }
function raiders(list) { return list.map(([kind, role, x, z]) => spawnEnemy(kind, role, V(x, 0, z))); }
function startRec() { doc.rec = true; doc.recAt = now(); log('REC start'); }
function finish() { doc.rec = false; doc.done = true; log('REC end'); }

/* =====================================================================================
 * Scenes
 * ===================================================================================== */
const SCENES = {};

/* A: the opening titles, the menus, and the first hour of play */
SCENES.A = async () => {
  await booted();
  audioOn();
  music.setState('menu');
  black(1, 0);
  await wait(2.5);
  startRec();
  const card = add(`<span class="eb">فيلم توثيقي</span><span class="logo">غَسَق</span>
    <p class="sub">لعبة تصويب عربية ثلاثية الأبعاد، صُنعت كلها بالكود</p>
    <p class="sub">لا صورة ولا ملف صوت: كل ما تراه وتسمعه يولد داخل المتصفح لحظة التشغيل</p>`, 'card');
  fade(card, { inAt: now() + 0.6, dur: 8.6, fin: 1.4, fout: 1.0, dy: 8 });
  await wait(10);
  black(0, 1.4);
  await wait(4);
  await pointTo(760, 560, 1.2);
  await click('#splash', 0.4);
  await until(() => document.body.dataset.screen === 'main', 5);
  caption('القائمة الرئيسية ليست صورة ثابتة: غزاة الخريطة الحالية يقفون في المشهد، والكاميرا تتنفّس ببطء.', { pos: 'bottomc', dur: 6.5 });
  await wait(1.2);
  await hover('#mainMenu [data-act="loadout"]', 0.9); await wait(0.8);
  await hover('#mainMenu [data-act="record"]', 0.7); await wait(0.8);
  await hover('#mainMenu [data-act="play"]', 0.8); await wait(1.2);
  await click('#mainMenu [data-act="play"]', 0.3);
  await wait(1.2);
  caption('الإحاطة: الكاميرا تحلّق فوق ساحة المعركة نفسها، وتُسقط عليها البوابات وأعشاش القنص وموقعك.', { pos: 'top', dur: 6 });
  await wait(4.5);
  await click('#mapList [data-map="village"]', 0.9);
  await until(() => !document.querySelector('#menuVeil.on'), 20);
  caption('ثلاث ساحات: قصر الرمال، والقرية المهجورة، ومحطة الوادي.', { pos: 'top', dur: 7.5 });
  await wait(3.2);
  await click('#mapList [data-map="station"]', 0.9);
  await until(() => !document.querySelector('#menuVeil.on'), 20);
  await wait(3.2);
  await click('#mapList [data-map="citadel"]', 0.9);
  await until(() => !document.querySelector('#menuVeil.on'), 20);
  await wait(1.5);
  await hover('#diffList [data-diff="legend"]', 0.8);
  caption('الصعوبة لا تزيد عدد الغزاة فحسب، بل تغيّر طريقة تفكيرهم: الالتفاف، والقنابل، والتنسيق.', { pos: 'top', dur: 5.5 });
  await wait(1.6);
  await hover('#diffList [data-diff="veteran"]', 0.6);
  await wait(2.4);
  await click('#briefTabs [data-btab="gear"]', 0.9);
  caption('العتاد: كل سلاح نموذج ثلاثي الأبعاد مبنيّ من أشكال هندسية في الكود، بطلاءات تُرسم برمجياً.', { pos: 'top', dur: 7 });
  await wait(2.2);
  await click('#weaponList [data-weapon="smg"]', 0.8); await wait(1.6);
  await click('#weaponList [data-weapon="shotgun"]', 0.7); await wait(1.6);
  await click('#weaponList [data-weapon="dmr"]', 0.7); await wait(1.6);
  await click('#weaponList [data-weapon="rifle"]', 0.7); await wait(1.2);
  await click('#briefStart', 1.0);
  ptr.tv = 0;
  // the run has started (wave 1 at 16:00): extra raiders out in the open so the first hour has a fight
  game.heliDue = -1;
  await wait(0.2);
  raiders([['raider', 'rifle', -6, -14], ['raider', 'rifle', 7, -18], ['raider', 'grenadier', -12, -24]]);
  keepComing(10, 5);
  botOn(player.pos.clone(), { roam: 1.6 });
  await wait(3.5);
  chapter('الفصل الأول', 'الساعة الأولى', '١٦:٠٠ · العصر', 4);
  await wait(6);
  caption('كل موجة ساعة من النهار: الشمس تتحرك فعلاً، والظلال تطول مع كل موجة حتى منتصف الليل.', { pos: 'left', dur: 6.5 });
  await wait(8);
  caption('الغزاة لا ينتظرون دورهم: يتنقّلون بين السواتر، ويلتفّون عليك، ويرمون القنابل على من يتحصّن.', { pos: 'left', dur: 6.5 });
  await wait(9);
  finish();
};

/* B: sunset, air support, the supply drop and its sniper rifle, a squad mate, focus */
SCENES.B = async () => {
  await booted();
  battle({ wave: 2, hour: 18.05, at: V(0, 0, 9), yaw: 0, sp: 6000 });
  raiders([['raider', 'rifle', -8, -16], ['raider', 'rifle', 6, -22], ['heavy', 'rifle', 1, -30]]);
  keepComing(12, 5);
  botOn(V(0, 0, 9));
  await wait(5);
  startRec();
  chapter('الفصل الثاني', 'الإسناد', '١٨:٠٠ · الغروب', 4.2);
  await wait(5);
  callSupport('uav'); log('uav');
  caption('نقاط الإسناد تُكسب بالقتال وتُنفق على الدعم الجوي. طائرة الاستطلاع تكشف الغزاة على البوصلة.', { pos: 'left', dur: 6.5 });
  await wait(6);
  callSupport('supply'); log('supply');
  await wait(1);
  caption('طائرة الإمداد تُسقط صندوقاً بالمظلة، دائماً داخل الأسوار وفي مكان تصل إليه.', { pos: 'left', dur: 6.5 });
  // watch the chute for the last part of its fall; the crate always carries the sniper rifle in this film
  await until(() => parachutes.some((p) => p.kind === 'cargo' && p.state === 'open' && p.pos.y < 40), 20);
  const chute = parachutes.find((p) => p.kind === 'cargo');
  if (chute) {
    bot.look = () => (chute.state === 'landed' ? null : chute.pos.clone().setY(chute.pos.y + 1));
    const saved = inv.primaries;
    await until(() => chute.state === 'landed' || chute.pos.y < 2.5, 15);
    inv.primaries = ['rifle', 'smg', 'shotgun'];
    await until(() => chute.state === 'landed', 3);
    await wait(1 / 30);
    inv.primaries = saved;
    bot.look = null;
    const crate = pickups.find((p) => p.kind === 'supply');
    log('crate offer', crate && crate.offer);
    if (crate) {
      await wait(1.5);
      const stand = crate.g.position.clone().add(_e.copy(player.pos).sub(crate.g.position).setY(0).normalize().multiplyScalar(1.3));
      bot.anchor.copy(stand); bot.hold = true;
      bot.move = stand;
      await until(() => !bot.move, 8);
      bot.look = crate.g.position.clone().setY(1.2);
      await wait(0.9);
      log('take', useNearest());
      await wait(0.7);
      log('holding', currentKey());
      bot.look = null; bot.hold = false;
      caption('فوق الصندوق سلاح إضافي: بندقية القنص «نشّاب» بمنظار يتمايل مع أنفاس الرامي.', { pos: 'left', dur: 6.5 });
      await wait(1.2);
      bot.range = 90;
      await wait(9);
    }
  }
  callSupport('ally'); log('ally');
  caption('رفيق يقفز بالمظلة فوق موقعك، يقاتل إلى جانبك ويكلّمك نصاً على اللاسلكي.', { pos: 'left', dur: 6.5 });
  await wait(7);
  if (inv.primaries.length > 1 && currentKey() !== 'rifle') { switchSlot('primary'); await wait(0.8); }
  bot.range = 70;
  raiders([['raider', 'rifle', -5, -12], ['raider', 'rifle', 5, -13], ['night', 'rifle', 0, -17]]);
  await wait(2.5);
  focus.meter = 100;
  setFocus(true, true); log('focus');
  caption('التركيز: الإصابات في الرأس تملؤه، وحين تطلقه يتباطأ الزمن حولك.', { pos: 'left', dur: 6 });
  await wait(7);
  await wait(2);
  finish();
};

/* C: nightfall, the weapon light, the helicopter, the air strike */
SCENES.C = async () => {
  await booted();
  battle({ wave: 4, hour: 20.45, at: V(0, 0, 9), yaw: 0, sp: 6000, primary: 'rifle', skin: 'tiger' });
  game.snipersDue = [];
  player.torch = true;
  raiders([['night', 'rifle', -7, -15], ['night', 'rifle', 6, -19], ['heavy', 'rifle', -2, -26]]);
  keepComing(12, 5);
  botOn(V(0, 0, 9));
  await wait(5);
  startRec();
  chapter('الفصل الثالث', 'حين يحلّ الليل', '٢٠:٠٠ · أول الليل', 4.2);
  await wait(4.5);
  caption('في الظلام يضيء مصباح سلاحك الطريق، وتفضح ليزرات الغزاة الحمراء مواقعهم.', { pos: 'left', dur: 6.5 });
  await wait(4);
  spawnHelicopter(4, () => ['night', 'rifle']); log('heli');
  await until(() => refs.heli && (refs.heli.state === 'hover' || refs.heli.g.position.distanceTo(player.pos) < 70), 25);
  caption('مروحية تُنزل الغزاة بالحبال. أسقطها قبل أن تُفرغ حمولتها.', { pos: 'left', dur: 6.5 });
  bot.heli = true; doc.heliMul = 3.2;
  await until(() => !refs.heli || refs.heli.state === 'crash' || refs.heli.state === 'dead', 22);
  log('heli state', refs.heli && refs.heli.state);
  await wait(1.5);
  bot.heli = false;
  await wait(5);
  // the strike: a group of raiders gathers across the courtyard, the laser marks them, the jet runs in
  // open sand left of the fountain, in plain view and about 20 m out
  const tgt = V(-7, 0, -9);
  raiders([['night', 'rifle', -9, -10], ['night', 'rifle', -5, -12], ['heavy', 'rifle', -8, -14], ['night', 'grenadier', -11, -8]]);
  await wait(3);
  callSupport('strike'); log('designate');
  bot.look = tgt; bot.hold = true;
  caption('الغارة الجوية: حدّد الهدف بمنظار الليزر، فتُلقي المقاتلة خمس قنابل على امتداده.', { pos: 'left', dur: 6.5 });
  await wait(2.4);
  await until(() => support.valid, 3);
  confirmStrike(); log('strike');
  await wait(7);
  bot.look = null; bot.hold = false;
  await wait(4);
  finish();
};

/* D: the village from the air, then a fight in a sandstorm */
SCENES.D = async () => {
  await booted();
  battle({ map: 'village', wave: 1, hour: 17.25, spawn: false, at: V(0, 0, 7), yaw: 0 });
  music.setState('menu');
  shot(orbit(V(0, 0, -2), 58, 34, 0.6, 0.05, -2, 44), { thinFog: 0.45 });
  await wait(1.5);
  startRec();
  chapter('الفصل الرابع', 'ساحات أخرى', 'القرية المهجورة', 4.2);
  await wait(5);
  caption('القرية المهجورة: شارعان يتقاطعان عند ساحة البئر، ومسجد بمئذنة يتخذها القنّاص عشّاً.', { pos: 'leftlow', dur: 6.5 });
  await wait(6.5);
  black(1, 0.5);
  await wait(0.6);
  endShot();
  // the stormy hour: sand closes in from both sides
  startWave(1); game.heliDue = -1; game.snipersDue = []; game.hour = 17.3; applyTOD(17.3);
  setStorm(true); game.storm = 0.85;
  player.pos.set(1.5, 0, 5); player.yaw = 0.2;
  raiders([['raider', 'rifle', -5, -10], ['raider', 'rifle', 6, -14], ['raider', 'grenadier', -3, -20]]);
  keepComing(10, 5);
  botOn(V(1.5, 0, 5), { range: 45 });
  await wait(0.6);
  black(0, 0.6);
  await wait(1);
  caption('العاصفة الرملية تعمي الطرفين: تنعدم الرؤية، فيقترب الغزاة أكثر.', { pos: 'left', dur: 6.5 });
  await wait(8);
  const e = enemies.find((x) => x.alive);
  if (e) await throwNade(e.pos.clone());
  await wait(8);
  finish();
};

/* E: the valley station at sunset */
SCENES.E = async () => {
  await booted();
  battle({ map: 'station', wave: 2, hour: 18.2, spawn: false, at: V(0, 0, 12), yaw: 0 });
  music.setState('menu');
  shot(orbit(V(0, 0, -2), 60, 36, 2.4, -0.05, 0, 44), { thinFog: 0.45 });
  await wait(1.5);
  startRec();
  caption('محطة الوادي: سكّتان بين ثلاثة أرصفة، وبرج ساعة يطلّ على الساحة، ومستودع يُقاتَل في داخله.', { pos: 'leftlow', dur: 7.5 });
  await wait(10);
  black(1, 0.5);
  await wait(0.6);
  // a crane shot from the forecourt: rising over the tracks to the clock tower
  shot(dolly(V(-1.5, 4, 11), V(0, 13, 14), V(0, 5, -14), V(0, 7.5, -14), 10, 52), { thinFog: 0.8 });
  black(0, 0.6);
  await wait(10);
  finish();
};

/* F: made of code - a day in a quarter minute, soldiers, aircraft, the numbers */
SCENES.F = async () => {
  await booted();
  audioOn();
  switchMap('station');
  showScreen(null);
  clearShowcase();
  game.state = 'menu';
  music.setState('menu');
  let hour = 14;
  applyTOD(hour);
  const lapse = (dt) => { hour = Math.min(22, hour + dt * 0.46); applyTOD(hour); };
  shot(orbit(V(0, 0, 0), 64, 40, 0.3, 0.06, -2, 46), { thinFog: 0.5 });
  await wait(1);
  hooks.push(lapse);
  startRec();
  chapter('الفصل الخامس', 'صُنعت من الكود', 'كيف بُنيت غَسَق', 4.2);
  await wait(5);
  caption('يوم كامل في ثوانٍ: الشمس والقمر والنجوم والضباب والإضاءة كلها حسابات، لا صور.', { pos: 'leftlow', dur: 7 });
  await wait(11);
  black(1, 0.5);
  await wait(0.6);
  hooks.splice(hooks.indexOf(lapse), 1);
  // the soldiers up close, in the late afternoon
  applyTOD(16.6);
  const troops = [['ally', 'rifle', -1.6, 0, { vel: V(0, 0, 0), crouch: false }], ['raider', 'rifle', -0.5, 0.5, { vel: V(0, 0, 1.4), ready: 1 }],
    ['heavy', 'rifle', 0.7, 0, { vel: V(0, 0, 0) }], ['night', 'grenadier', 1.8, 0.4, { vel: V(0, 0, 0), crouch: true }]];
  const built = troops.map(([kind, role, x, zo, o], i) => {
    const ch = buildSoldier(kind, 21 + i, role);
    ch.root.position.set(x, 0, 18 + zo); ch.root.rotation.y = 0.3;
    scene.add(ch.root);
    return { ch, o };
  });
  const anim = (dt) => { for (const b of built) animateSoldier(b.ch, dt, { ...b.o, vel: b.o.vel.clone().multiplyScalar(0.0001) }); };
  hooks.push(anim);
  shot(dolly(V(-2.4, 1.5, 22.8), V(2.2, 1.3, 22.4), V(-0.6, 1.05, 18), V(0.8, 1.0, 18), 11, 46), { thinFog: 1 });
  black(0, 0.6);
  caption('الجنود يُبنون من أشكال هندسية، وتُرسم أقمشتهم وتمويههم وأعلامهم على لوحات canvas عند التشغيل.', { pos: 'leftlow', dur: 7.5 });
  await wait(10);
  black(1, 0.5);
  await wait(0.6);
  hooks.splice(hooks.indexOf(anim), 1);
  for (const b of built) scene.remove(b.ch.root);
  // the fleet passing overhead
  applyTOD(15.8);
  const fleet = [
    [buildTransport(), V(-120, 34, -70), V(1, 0, 0.12), 26, 0.12],
    [buildHeli(), V(-30, 11, -26), V(0.9, 0, 0.2), 6, 0],
    [buildJet(), V(-200, 22, -40), V(1, 0, 0.05), 95, -0.5],
    [buildUAV(), V(-40, 18, -16), V(1, 0, -0.1), 9, 0.25],
  ].map(([m, p, d, sp, bank]) => { scene.add(m.g); d.normalize(); return { m, p, d, sp, bank }; });
  const fly = (dt) => {
    for (const f of fleet) {
      f.p.addScaledVector(f.d, f.sp * dt);
      f.m.g.position.copy(f.p);
      f.m.g.rotation.set(0, Math.atan2(f.d.x, f.d.z), f.bank, 'YXZ');
      if (f.m.props) for (const pr of f.m.props) pr.rotation.z += dt * 42;
      if (f.m.rotor) f.m.rotor.rotation.y += dt * 30;
      if (f.m.tail) f.m.tail.rotation.x += dt * 40;
    }
  };
  hooks.push(fly);
  shot((t) => ({ pos: V(0, 14, 20), look: V(-8 + t * 1.3, 17, -24), fov: 58 }), { thinFog: 0.7 });
  black(0, 0.6);
  caption('الطائرات والمروحية والقنابل نماذج من الكود أيضاً، وأصوات محركاتها تُركَّب بـ Web Audio لحظة بلحظة.', { pos: 'leftlow', dur: 7.5 });
  await wait(9);
  // the numbers
  const st = add(`<h4>غَسَق بالأرقام</h4><div class="g">
    <div class="c"><b>١٣٬٧٩١</b><span>سطراً برمجياً</span></div>
    <div class="c"><b>٧١</b><span>ملفاً: ٦٥ JavaScript و٥ CSS وصفحة HTML</span></div>
    <div class="c"><b>٠</b><span>صورة أو ملف صوت خارجي</span></div>
    <div class="c"><b>٣</b><span>خرائط تُبنى عند التحميل</span></div>
    <div class="c"><b>٨</b><span>موجات من العصر حتى منتصف الليل</span></div>
    <div class="c"><b>٣</b><span>منصّات: الويب وأندرويد وويندوز</span></div>
  </div><div class="tech">Three.js · cannon-es · Vite · Web Audio · Canvas 2D</div>`, 'stats');
  fade(st, { dur: 9, fin: 0.9, fout: 0.9, dy: 10 });
  await wait(10);
  hooks.splice(hooks.indexOf(fly), 1);
  finish();
};

/* G: the last hour, victory at midnight, the after-action report, the end card */
SCENES.G = async () => {
  await booted();
  battle({ wave: 7, hour: 23.35, at: V(0, 0, 9), yaw: 0, sp: 4000, primary: 'rifle', skin: 'night' });
  game.toSpawn = 4; game.maxAlive = 4; game.snipersDue = []; game.heliDue = -1;
  player.torch = true;
  raiders([['night', 'rifle', -6, -14], ['heavy', 'rifle', 5, -18], ['night', 'rifle', 1, -24]]);
  botOn(V(0, 0, 9), { head: 0.55 });
  await wait(5);
  startRec();
  chapter('الفصل السادس', 'منتصف الليل', '٢٣:٠٠ · الساعة الأخيرة', 4.2);
  await wait(6);
  caption('الساعة الأخيرة: أكثر الغزاة عدداً وأشدّهم دقة، ولم يبقَ إلا القليل حتى منتصف الليل.', { pos: 'left', dur: 6.5 });
  // the last raiders: make sure the fight ends inside the film
  await until(() => game.state !== 'playing', 30);
  if (game.state === 'playing') {
    log('forcing the end', enemies.filter((e) => e.alive).length, game.toSpawn);
    game.toSpawn = 0;
    for (const e of enemies.slice()) if (e.alive) e.takeDamage(999, 'torso', e.pos.clone().setY(1.2), V(0, 0, -1), 'rifle', 20);
  }
  log('victory', run.won);
  botOff();
  await until(() => game.state === 'over', 12);
  await wait(2.5);
  caption('تقرير ما بعد المعركة: النقاط والتقييم والأوسمة، والترقية إلى الرتبة التالية.', { pos: 'right', dur: 7 });
  await wait(9);
  black(1, 1.2);
  await wait(1.3);
  const card = add(`<span class="logo">غَسَق</span>
    <p class="sub">الإصدار ٢٫٢ · للويب وأندرويد وويندوز</p>
    <p class="sub">جميع اللقطات مسجّلة من داخل اللعبة · اللعب في هذا الفيلم للاعب آلي</p>`, 'card');
  fade(card, { dur: 8, fin: 1.2, fout: 1.4, dy: 8 });
  await wait(9.5);
  finish();
};

doc.scenes = Object.keys(SCENES);
doc.run = (id) => {
  doc.scene = id;
  log('scene', id);
  SCENES[id]().catch((e) => { log('ERROR', e && e.stack ? e.stack : e); doc.error = String(e); finish(); });
};
doc.still = (on) => { stillFrame = on; };
log('director ready');
