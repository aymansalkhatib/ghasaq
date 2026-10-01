import * as THREE from 'three';
import { clamp, damp, lerp, smooth, wrapAngle } from '../core/utils.js';
import { camera } from '../core/renderer.js';
import { updateTorch } from '../fx/torch.js';
import { vocal } from '../audio/vocal.js';
import { makeActorBody, driveActor } from '../core/physics.js';
import { game, run, enemies } from '../core/state.js';
import { settings, reduceMotion } from '../config/settings.js';
import { PLAYER, DIFFICULTY } from '../config/balance.js';
import { slideCircle, supportHeight, ceilingAbove, surfaceAt } from '../world/collision.js';
import { PLAYER_START, MAP_INFO } from '../world/map.js';
import { sfx } from '../audio/sfx.js';
import { input, moveVector } from '../input/input.js';
import { weaponState, currentWeapon } from '../weapons/arsenal.js';
import { focus } from '../systems/focus.js';
import { showDamageDir, screenBlood, showKilledBy } from '../ui/hud.js';
import { onPlayerDied } from '../systems/waves.js';
import { noise } from './enemy.js';

/* The player: movement, stamina, collisions, camera, health and aim assistance. */

export const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, eyeH: 1.62,
  crouch: false, sprinting: false, stamina: PLAYER.stamina, staminaT: 0, onGround: true,
  hp: PLAYER.hp, armor: PLAYER.armor, alive: true, speed2d: 0, lastHurt: 99,
  shake: 0, recoilP: 0, recoilY: 0, bobT: 0, stepDist: 0, land: 0, hurtFx: 0, torch: false, deadT: 0,
  voice: { f0: 112, tract: 1, until: 0 }, lastCry: 0, beatT: 0,
  body: null, swayX: 0, swayY: 0, breathT: 0, lookSource: 'mouse', mantle: null, airT: 0,
};

export function resetPlayer() {
  Object.assign(player, {
    yaw: MAP_INFO.startYaw, pitch: 0, eyeH: 1.62, crouch: false, sprinting: false, stamina: PLAYER.stamina, onGround: true,
    hp: PLAYER.hp, armor: PLAYER.armor, alive: true, speed2d: 0, lastHurt: 99, shake: 0, recoilP: 0, recoilY: 0,
    land: 0, hurtFx: 0, deadT: 0, torch: false, lastAttacker: '', lastAttackDist: 0, suppress: 0, mantle: null, airT: 0,
  });
  player.pos.copy(PLAYER_START);
  player.vel.set(0, 0, 0);
  if (!player.body) player.body = makeActorBody();
}

player.hurt = function (dmg, from, explosive = false, attacker = '') {
  if (!this.alive || dmg <= 0) return;
  if (attacker) { this.lastAttacker = attacker; this.lastAttackDist = from ? Math.round(Math.hypot(from.x - this.pos.x, from.z - this.pos.z)) : 0; }
  const absorbed = Math.min(this.armor, dmg * PLAYER.armorAbsorb);
  this.armor -= absorbed;
  this.hp -= dmg - absorbed;
  run.dmgTaken += dmg;
  run.waveDmg += dmg;
  run.streak = 0;
  this.lastHurt = 0;
  this.hurtFx = Math.min(1, this.hurtFx + 0.3 + dmg / 50);
  this.recoilP += 0.004 + Math.random() * 0.008;
  this.shake = Math.max(this.shake, explosive ? 1 : 0.25);
  sfx.hurt();
  // your own voice: a grunt for a graze, a cry for a real wound; never one per bullet of a burst
  const big = dmg >= 24 || explosive, t = performance.now();
  if (t - this.lastCry > (big ? 350 : 750)) { this.lastCry = t; vocal(big ? 'cry' : 'grunt', null, this.voice, big ? 1 : 0.8); }
  if (from) showDamageDir(from);
  screenBlood(dmg);
  if (this.hp <= 0) { this.hp = 0; die(); }
};
function die() {
  player.alive = false;
  player.deadT = 0;
  weaponState.firing = false;
  showKilledBy(player.lastAttacker || 'نيران الغزاة', player.lastAttackDist || 0);
  onPlayerDied();
}
player.heal = function (hp, armor = 0) {
  this.hp = Math.min(PLAYER.hp, this.hp + hp);
  this.armor = Math.min(100, this.armor + armor);
};

/* ---------- looking around ---------- */
const _v = new THREE.Vector3();
/** Nearest raider close to the crosshair: { dyaw, dpitch, ang } or null. */
function assistTarget(maxAng) {
  let best = null;
  for (const e of enemies) {
    if (!e.alive || !e.canSee || e.pos.distanceTo(player.pos) > 60) continue;
    _v.set(e.pos.x, e.pos.y + 1.3, e.pos.z).sub(camera.position);
    const yawT = Math.atan2(-_v.x, -_v.z), pitchT = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    const dyaw = wrapAngle(yawT - (player.yaw + player.recoilY)), dpitch = pitchT - (player.pitch + player.recoilP);
    const ang = Math.hypot(dyaw, dpitch);
    if (ang < maxAng && (!best || ang < best.ang)) best = { dyaw, dpitch, ang };
  }
  return best;
}
/** dx/dy in pixels (mouse/touch) or stick units scaled by the caller. */
export function applyLook(dx, dy, source = 'mouse') {
  if (!player.alive) return;
  player.lookSource = source;
  const W = currentWeapon();
  const zoom = lerp(1, W.zoom, weaponState.ads) ** 0.85 * lerp(1, settings.adsSens, weaponState.ads);
  let s = 0.0021 * zoom * (source === 'touch' ? settings.touchSens * 1.5 : settings.sens);
  if (source !== 'mouse' && settings.aimAssist && assistTarget(0.1)) s *= 0.55;
  player.yaw -= dx * s;
  player.pitch = clamp(player.pitch - dy * s * (settings.invertY ? -1 : 1), -1.45, 1.45);
  input.swayX += dx; input.swayY += dy;
}

/* ---------- vaulting and climbing ---------- */
const _t = new THREE.Vector3();
/**
 * A ledge in direction (dx, dz) that a soldier can pull himself onto: a box top 0.5–1.6 m above
 * the feet with room to stand on it, or a wall up to 1.25 m high and thin enough to vault
 * (then the landing is on the far side). Returns { to, top } or null.
 */
function findLedge(P, dx, dz) {
  const y0 = P.pos.y;
  let edge = -1, top = 0;
  for (let d = 0.3; d <= 0.95; d += 0.08) {
    const h = supportHeight(P.pos.x + dx * d, P.pos.z + dz * d, y0 + 1.62, 0.05);
    if (h - y0 >= 0.5) { edge = d; top = h; break; }
  }
  if (edge < 0 || top - y0 > 1.6) return null;
  const free = (x, z, y) => { _t.set(x, y, z); slideCircle(_t, 0, 0, 0.34, 1.2, 0.05); return Math.hypot(_t.x - x, _t.z - z) < 0.01; };
  // climb on top: the landing circle must be fully on that surface, with head room
  const lx = P.pos.x + dx * (edge + 0.42), lz = P.pos.z + dz * (edge + 0.42);
  const onTop = supportHeight(lx, lz, top + 0.05, 0.3);
  if (Math.abs(onTop - top) < 0.06 && ceilingAbove(lx, lz, top) > top + 1.25 && free(lx, lz, top)) return { to: new THREE.Vector3(lx, top, lz), top };
  // vault a thin wall onto the ground beyond it
  if (top - y0 > 1.25) return null;
  for (const far of [0.75, 1.0, 1.3]) {
    const fx = P.pos.x + dx * (edge + far), fz = P.pos.z + dz * (edge + far);
    const g = supportHeight(fx, fz, top - 0.3, 0.3);
    if (g < top - 0.4 && free(fx, fz, g)) return { to: new THREE.Vector3(fx, g, fz), top };
  }
  return null;
}
function startMantle(P, ledge) {
  const h = ledge.top - P.pos.y;
  P.mantle = { from: P.pos.clone(), to: ledge.to, peak: ledge.top + 0.12, t: 0, dur: 0.32 + h * 0.2 };
  P.vel.set(0, 0, 0);
  P.onGround = false;
  sfx.jump();
}
function updateMantle(P, dt) {
  const m = P.mantle;
  m.t += dt;
  const u = Math.min(1, m.t / m.dur);
  // pull up first, then roll forward over the edge (and drop down on the far side of a wall)
  const rise = smooth(Math.min(1, u / 0.55)), fwd = smooth(clamp((u - 0.3) / 0.7, 0, 1));
  const y = u < 0.55 ? lerp(m.from.y, m.peak, rise) : lerp(m.peak, m.to.y, smooth((u - 0.55) / 0.45));
  P.pos.set(lerp(m.from.x, m.to.x, fwd), y, lerp(m.from.z, m.to.z, fwd));
  if (u >= 1) {
    P.pos.copy(m.to);
    P.mantle = null;
    P.onGround = true;
    P.land = Math.max(P.land, 0.35);
    sfx.land();
  }
}

/* ---------- per-frame update ---------- */
export function updatePlayer(dt) {
  const P = player;
  if (!P.alive) {
    P.deadT += dt;
    const k = smooth(Math.min(1, P.deadT / 1.1));
    camera.position.set(P.pos.x, P.pos.y + lerp(P.eyeH, 0.35, k), P.pos.z);
    camera.rotation.set(P.pitch * (1 - k) - 0.25 * k, P.yaw, 1.15 * k);
    return;
  }
  // below half health the heart pounds: faster and louder the lower it gets (focus has its own beat)
  if (P.hp < 50 && !focus.active) {
    P.beatT -= dt;
    if (P.beatT <= 0) { const k = 1 - P.hp / 50; P.beatT = 1.05 - k * 0.55; sfx.heartbeat(0.7 + k * 0.6, P.beatT); }
  } else P.beatT = 0;
  const mv = moveVector();
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  // stay crouched under a low ceiling even after the key is released
  P.crouch = input.crouch || (P.crouch && ceilingAbove(P.pos.x, P.pos.z, P.pos.y) < P.pos.y + 1.8);
  const W = currentWeapon();
  const wantSprint = input.sprint && mv.y > 0.5 && !P.crouch && weaponState.ads < 0.2 && !weaponState.firing && weaponState.reload <= 0;
  P.staminaT -= dt;
  if (wantSprint && P.stamina > 0) {
    P.sprinting = true;
    P.stamina = Math.max(0, P.stamina - PLAYER.staminaDrain * dt);
    P.staminaT = PLAYER.staminaDelay;
    if (P.stamina === 0) { P.breathT = 0; sfx.breath(); }
  } else {
    P.sprinting = false;
    if (P.staminaT <= 0) P.stamina = Math.min(PLAYER.stamina, P.stamina + PLAYER.staminaRegen * dt);
  }
  const base = P.crouch ? PLAYER.crouch : P.sprinting ? PLAYER.sprint : PLAYER.walk;
  const maxSpd = base * W.mobility * lerp(1, PLAYER.adsMove, weaponState.ads);
  const wx = (fx * mv.y + rx * mv.x) * maxSpd, wz = (fz * mv.y + rz * mv.x) * maxSpd;
  const acc = P.onGround ? 11 : 2.2;
  P.vel.x += (wx - P.vel.x) * damp(acc, dt);
  P.vel.z += (wz - P.vel.z) * damp(acc, dt);
  // the direction the player is pushing (or looking, when standing still) for vault checks
  const ml = Math.hypot(mv.x, mv.y), pushing = mv.y > 0.3;
  const vx = ml > 0.1 ? (fx * mv.y + rx * mv.x) / ml : fx, vz = ml > 0.1 ? (fz * mv.y + rz * mv.x) / ml : fz;
  const height = P.crouch ? 1.2 : 1.78;
  if (P.mantle) {
    input.jump = false;
    updateMantle(P, dt);
  } else {
    if (input.jump && P.onGround && !P.crouch) {
      // jumping at a crate or a low wall climbs onto it (or vaults it) instead of bumping into it
      const ledge = pushing ? findLedge(P, vx, vz) : null;
      if (ledge && ledge.top - P.pos.y > 0.62) startMantle(P, ledge);
      else { P.vel.y = PLAYER.jump; P.onGround = false; P.airT = 0; sfx.jump(); }
    }
    input.jump = false;
    // still pushing forward at the top of a jump: catch the ledge and pull up
    P.airT = P.onGround ? 0 : P.airT + dt;
    if (!P.mantle && !P.onGround && pushing && P.airT < 0.8 && P.vel.y < 2.5) {
      const ledge = findLedge(P, vx, vz);
      if (ledge && ledge.top - P.pos.y < 1.05) startMantle(P, ledge);
    }
  }
  if (!P.mantle) {
    P.vel.y -= PLAYER.gravity * dt;
    slideCircle(P.pos, P.vel.x * dt, P.vel.z * dt, 0.36, height, P.onGround ? 0.46 : 0.08);
    const prevY = P.pos.y;
    P.pos.y += P.vel.y * dt;
    const sup = supportHeight(P.pos.x, P.pos.z, prevY + (P.onGround ? 0.46 : 0.02), 0.26);
    if (P.pos.y <= sup || (P.onGround && P.vel.y <= 0 && P.pos.y - sup < 0.46)) {
      if (!P.onGround && P.vel.y < -5) { P.land = Math.min(1, -P.vel.y / 12); sfx.land(); }
      P.pos.y = sup; P.vel.y = 0; P.onGround = true;
    } else P.onGround = false;
    const ceil = ceilingAbove(P.pos.x, P.pos.z, prevY);
    if (P.vel.y > 0 && ceil < P.pos.y + height) { P.pos.y = ceil - height; P.vel.y = 0; }
  }
  P.speed2d = Math.hypot(P.vel.x, P.vel.z);
  P.eyeH += ((P.crouch ? 1.08 : 1.62) - P.eyeH) * damp(12, dt);

  // health regenerates to the next 25-point segment on recruit and veteran
  P.lastHurt += dt;
  if (DIFFICULTY[game.diff].regen && P.lastHurt > 5 && P.hp < 100) {
    const cap = Math.min(100, Math.ceil(P.hp / 25) * 25);
    if (P.hp < cap) P.hp = Math.min(cap, P.hp + 9 * dt);
  }

  if (P.onGround && P.speed2d > 0.5) {
    P.bobT += dt * P.speed2d * 1.85;
    P.stepDist += P.speed2d * dt;
    if (P.stepDist > (P.sprinting ? 2.4 : 2.05)) {
      P.stepDist = 0;
      // raiders nearby can hear footsteps (never a crouched walk)
      if (!P.crouch) { sfx.step(surfaceAt(P.pos.x, P.pos.z, P.pos.y), clamp(P.speed2d / 7, 0.15, 0.6)); noise(P.pos, P.sprinting ? 17 : 8, 'step'); }
    }
  }
  const bobAmt = clamp(P.speed2d / 5, 0, 1.3) * (P.onGround ? 1 : 0) * (1 - weaponState.ads * 0.8);
  P.land *= Math.exp(-8 * dt);
  P.recoilP *= Math.exp(-(weaponState.firing ? 1.2 : 5.5) * dt);
  P.recoilY *= Math.exp(-5.5 * dt);
  P.shake *= Math.exp(-6 * dt);
  P.hurtFx *= Math.exp(-2.2 * dt);

  // gentle aim magnetism for touch and gamepad while aiming or firing
  if (settings.aimAssist && P.lookSource !== 'mouse' && (weaponState.ads > 0.5 || input.fire)) {
    const t = assistTarget(0.09);
    if (t) { const k = Math.min(1, dt * 2.2); P.yaw += t.dyaw * k * 0.5; P.pitch += t.dpitch * k * 0.5; }
  }

  // smooth (noise-like) shake instead of random per-frame jumps, so the view never "teleports"
  const sh = (reduceMotion ? 0.3 : 1) * Math.min(P.shake, 1.2);
  const tt = performance.now() * 0.001;
  const n1 = Math.sin(tt * 37) * 0.6 + Math.sin(tt * 61) * 0.4, n2 = Math.sin(tt * 43 + 1) * 0.6 + Math.sin(tt * 71 + 2) * 0.4;
  camera.position.set(
    P.pos.x + n1 * sh * 0.04,
    P.pos.y + P.eyeH + Math.sin(P.bobT * 2) * 0.03 * bobAmt - P.land * 0.12 + n2 * sh * 0.04,
    P.pos.z + n2 * sh * 0.03,
  );
  const sway = W.sight === 'scope' ? weaponState.scopeSway : 0;
  camera.rotation.set(P.pitch + P.recoilP + sway * Math.sin(performance.now() * 0.0011), P.yaw + P.recoilY + sway * Math.sin(performance.now() * 0.0007), Math.sin(P.bobT) * 0.006 * bobAmt + n1 * sh * 0.008);
  driveActor(P.body, P.pos, P.vel);

  updateTorch(dt, P.torch);
}
