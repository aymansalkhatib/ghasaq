import * as THREE from 'three';
import { CANNON } from '../core/physics.js';
import { TAU, clamp, damp, lerp, rand, smooth } from '../core/utils.js';
import { camera, vmFlash } from '../core/renderer.js';
import { game, run, enemies } from '../core/state.js';
import { settings, isTouch } from '../config/settings.js';
import { WEAPONS, GRENADE, MELEE } from '../config/balance.js';
import { damageProp } from '../world/props.js';
import { scatterBirds } from '../world/ambient.js';
import { fx } from '../fx/particles.js';
import { decal, DMAT } from '../fx/decals.js';
import { tracer, flashLight, ejectCasing } from '../fx/tracers.js';
import { sfx } from '../audio/sfx.js';
import { raycaster, hitNormal, bulletTargets } from '../entities/combat.js';
import { player } from '../entities/player.js';
import { noise } from '../entities/enemy.js';
import { input } from '../input/input.js';
import { vmRoot, models, nadeHand, knifeHand } from './viewmodels.js';
import { playerNade } from './grenades.js';
import { hitMarker, showMsg, updateAmmoHUD } from '../ui/hud.js';

/* Inventory, firing, reloading and the first-person weapon animation. */

export const inv = { primary: 'rifle', slot: 'primary', ammo: {}, nades: GRENADE.carry };
export const weaponState = {
  cd: 0, reload: 0, reloadDur: 0, reloadEmpty: false, reloadSounds: 0, shells: false,
  sw: 0, swTo: null, ads: 0, heat: 0, firing: false, lastShot: 0, kick: 0, latch: false, flashT: 0,
  pumpT: 0, pumped: true, scopeSway: 0, scoped: false, spreadPx: 8, autoFire: false,
  meleeT: 0, meleeHit: true,
};
/*
 * Inventory: up to two primary weapons (the second one comes from a supply crate) plus the pistol.
 * `slot` is 'primary' or 'secondary'; `pIndex` picks which primary is in hand.
 */
export const currentKey = () => (inv.slot === 'primary' ? inv.primaries[inv.pIndex] : 'pistol');
export const currentWeapon = () => WEAPONS[currentKey()];
/** Every weapon carried, in switch order. */
export const carried = () => [...inv.primaries, 'pistol'];

export function resetArsenal(primary) {
  inv.primaries = [primary]; inv.pIndex = 0; inv.slot = 'primary'; inv.nades = GRENADE.carry;
  inv.ammo = {};
  for (const k of [primary, 'pistol']) inv.ammo[k] = { mag: WEAPONS[k].mag, res: WEAPONS[k].reserve };
  Object.assign(weaponState, { cd: 0, reload: 0, sw: 0, swTo: null, ads: 0, heat: 0, firing: false, kick: 0, pumpT: 0, pumped: true, scoped: false, meleeT: 0, meleeHit: true });
  for (const k in models) models[k].g.visible = k === primary;
  updateAmmoHUD(true);
}
/** Take a weapon (from a supply crate). With two primaries already, it replaces the one in hand. */
export function giveWeapon(key) {
  if (!inv.ammo[key]) inv.ammo[key] = { mag: WEAPONS[key].mag, res: WEAPONS[key].reserve };
  else inv.ammo[key].res = Math.max(inv.ammo[key].res, WEAPONS[key].reserve);
  let idx = inv.primaries.indexOf(key);
  if (idx < 0) {
    if (inv.primaries.length < 2) { inv.primaries.push(key); idx = inv.primaries.length - 1; }
    else { idx = inv.slot === 'primary' ? inv.pIndex : 0; inv.primaries[idx] = key; }
  }
  weaponState.reload = 0;
  weaponState.swDur = weaponState.sw = 0.5;
  weaponState.swTo = { slot: 'primary', idx };
  sfx.click(1400, 0.3);
  updateAmmoHUD(true);
}
/** Refill reserves by a fraction of their maximum (1 = full). */
export function refillAmmo(frac) {
  for (const k in inv.ammo) {
    const W = WEAPONS[k], A = inv.ammo[k];
    A.res = Math.min(W.reserveMax, A.res + Math.ceil(W.reserveMax * frac));
  }
  updateAmmoHUD(true);
}
export const busy = () => weaponState.reload > 0 || weaponState.sw > 0 || weaponState.meleeT > 0 || playerNade.throwT > 0 || playerNade.cooking || !!player.mantle;

/* ---------- knife ---------- */
export function melee() {
  const ws = weaponState;
  if (ws.meleeT > 0 || ws.sw > 0 || playerNade.cooking || playerNade.throwT > 0 || !player.alive) return;
  ws.reload = 0; ws.shells = false;
  ws.meleeT = MELEE.duration;
  ws.meleeHit = false;
  sfx.swish();
}
function doMelee() {
  const f = _f.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  let best = null, bestD = MELEE.range;
  for (const e of enemies) {
    if (!e.alive || e.rope) continue;
    const dx = e.pos.x - player.pos.x, dz = e.pos.z - player.pos.z, d = Math.hypot(dx, dz);
    if (d > bestD || Math.abs(e.pos.y - player.pos.y) > 1.5) continue;
    if (Math.acos(clamp((dx * f.x + dz * f.z) / (d || 1), -1, 1)) > MELEE.cone) continue;
    best = e; bestD = d;
  }
  if (best) {
    const dir = new THREE.Vector3(best.pos.x - player.pos.x, 0, best.pos.z - player.pos.z).normalize();
    // the raider faces away from us: a silent kill
    const back = Math.sin(best.yaw) * dir.x + Math.cos(best.yaw) * dir.z > 0.35;
    best.backstabbed = back;
    const point = new THREE.Vector3(best.pos.x, best.pos.y + 1.2, best.pos.z);
    const killed = best.takeDamage(back ? 999 : MELEE.dmg, 'torso', point, dir, 'knife', 45);
    hitMarker(killed, false);
    sfx.stab();
    player.shake = Math.max(player.shake, 0.3);
    run.hits++;
    return;
  }
  raycaster.set(camera.position, _u.set(0, 0, -1).applyQuaternion(camera.quaternion));
  raycaster.near = 0.1; raycaster.far = 1.8;
  const h = raycaster.intersectObjects(bulletTargets.world(), false)[0];
  if (h) { fx.impact(h.point, hitNormal(h).clone(), h.object.userData.surface || 'stone'); sfx.impact(h.object.userData.surface || 'stone', h.point, 0.8); }
}

export function startReload() {
  const key = currentKey(), W = WEAPONS[key], A = inv.ammo[key];
  if (busy() || A.mag >= W.mag || A.res <= 0) return;
  if (W.pellets) {
    weaponState.shells = true;
    weaponState.reloadDur = W.shellTime;
    weaponState.reload = W.shellTime + 0.25;
  } else {
    weaponState.shells = false;
    weaponState.reloadEmpty = A.mag === 0;
    weaponState.reloadDur = weaponState.reloadEmpty ? W.reloadEmpty : W.reload;
    weaponState.reload = weaponState.reloadDur;
  }
  weaponState.reloadSounds = 0;
  showMsg('إعادة تعبئة…', 800);
}
/**
 * 'primary' (pressing it again alternates between two primaries), 'secondary' (pistol),
 * or 'toggle' (cycle through everything carried: wheel, gamepad, touch).
 */
export function switchSlot(to) {
  if (weaponState.sw > 0 || playerNade.throwT > 0) return;
  let target;
  if (to === 'toggle') {
    const list = carried(), cur = list.indexOf(currentKey()), nk = list[(cur + 1) % list.length];
    target = nk === 'pistol' ? { slot: 'secondary', idx: inv.pIndex } : { slot: 'primary', idx: inv.primaries.indexOf(nk) };
  } else if (to === 'primary') {
    if (inv.slot === 'primary') { if (inv.primaries.length < 2) return; target = { slot: 'primary', idx: 1 - inv.pIndex }; }
    else target = { slot: 'primary', idx: inv.pIndex };
  } else {
    if (inv.slot === 'secondary') return;
    target = { slot: 'secondary', idx: inv.pIndex };
  }
  weaponState.reload = 0;
  // drawing or holstering the sidearm is quicker than slinging a long gun
  weaponState.swDur = weaponState.sw = target.slot === 'secondary' || inv.slot === 'secondary' ? 0.36 : 0.5;
  weaponState.swTo = target;
  sfx.click(1400, 0.25);
}

/* ---------- firing ---------- */
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _m = new THREE.Vector3(), _e = new THREE.Vector3(), _p = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
let friendlyWarnT = 0;
function falloff(W, d) {
  if (!W.falloff) return 1;
  const [a, b, min] = W.falloff;
  return d <= a ? 1 : d >= b ? min : lerp(1, min, (d - a) / (b - a));
}
/** One projectile path: resolves hits, penetration and effects. Returns { hit, killed, head, end }. */
function fireRay(origin, dir, W, key, dmgScale) {
  const res = { hit: false, killed: false, head: false, armor: false, end: _e.copy(origin).addScaledVector(dir, 400) };
  let from = origin.clone(), dmg = W.dmg * dmgScale, skip = null, travelled = 0;
  for (let pass = 0; pass < 2; pass++) {
    raycaster.set(from, dir); raycaster.near = pass ? 0.02 : 0.1; raycaster.far = 400 - travelled;
    const hits = raycaster.intersectObjects(bulletTargets.all(), false).filter((h) => h.object !== skip);
    const h = hits[0];
    if (!h) break;
    res.end.copy(h.point);
    const ud = h.object.userData, dist = travelled + h.distance;
    if (ud.heli) { ud.heli.hit(dmg * 0.9, h.point); fx.sparks(h.point, hitNormal(h).clone(), 6); res.hit = true; break; }
    if (ud.ch) {
      const e = ud.ch.enemy;
      if (e && e.alive) {
        res.hit = true;
        res.head = ud.part === 'head';
        res.armor = e.kind === 'heavy' && ud.part === 'torso';
        if (e.takeDamage(dmg * falloff(W, dist), ud.part, h.point.clone(), dir.clone(), key, W.impulse)) res.killed = true;
        sfx.impact('flesh', h.point, 0.8);
      } else if (ud.ch.ally) {
        if (ud.ch.ally.alive) ud.ch.ally.friendlyHit(dmg, h.point.clone(), dir.clone());
        if (friendlyWarnT <= 0) { friendlyWarnT = 3; showMsg('لا تطلق النار على رفيقك!', 1400); }
      } else if (ud.ragBody) {
        ud.ragBody.wakeUp();
        ud.ragBody.applyImpulse(new CANNON.Vec3(dir.x * 30, dir.y * 30 + 5, dir.z * 30), new CANNON.Vec3(h.point.x - ud.ragBody.position.x, h.point.y - ud.ragBody.position.y, h.point.z - ud.ragBody.position.z));
        fx.blood(h.point, dir, 0.7);
        sfx.impact('flesh', h.point, 0.6);
      }
      break;
    }
    const n = hitNormal(h).clone(), surface = ud.surface || 'stone';
    fx.impact(h.point, n, surface);
    sfx.impact(surface, h.point, 0.5);
    if (ud.prop) { damageProp(ud.prop, dmg, h.point, dir, 3); if (ud.prop.alive) decal(h.point, n, DMAT.hole, rand(0.08, 0.11), ud.prop.mesh); }
    else decal(h.point, n, DMAT.hole, rand(0.09, 0.13));
    // rounds punch through wooden crates with reduced damage
    if (surface !== 'wood' || !W.pen) break;
    dmg *= W.pen;
    travelled = dist;
    from = h.point.clone().addScaledVector(dir, 0.02);
    skip = h.object;
  }
  return res;
}

/** Raiders within 1.8 m of the bullet's path (and not hit by it) are suppressed. */
function suppressAlong(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1) return;
  for (const e of enemies) {
    if (!e.alive || e.rope) continue;
    const px = e.pos.x - from.x, py = e.pos.y + 1.2 - from.y, pz = e.pos.z - from.z;
    const t = clamp((px * dx + py * dy + pz * dz) / len2, 0, 1);
    const cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t, d = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (d > 0.45 && d < 1.8) e.suppress(0.28 * (1.8 - d));
  }
}

function shoot() {
  const key = currentKey(), W = WEAPONS[key], A = inv.ammo[key];
  if (A.mag <= 0) {
    sfx.dry();
    weaponState.cd = 0.25;
    if (A.res > 0) startReload(); else showMsg('نفدت الذخيرة · بدّل السلاح بالزر 1 أو 2', 1400);
    return;
  }
  A.mag--; run.shots++;
  weaponState.cd = 60 / W.rpm;
  const ads = weaponState.ads, moving = clamp(player.speed2d / 5, 0, 1);
  const spread = lerp(W.spread + moving * W.moveSpread + (player.onGround ? 0 : W.jumpSpread) + Math.min(weaponState.heat, 10) * (W.bloom ?? 0.0022),
    W.adsSpread + moving * W.moveSpread * 0.35 + (player.onGround ? 0 : W.jumpSpread), ads) * (player.crouch ? 0.7 : 1);
  camera.updateMatrixWorld();
  const f = _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const r = _r.set(1, 0, 0).applyQuaternion(camera.quaternion), u = _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const muzzle = camera.localToWorld(_m.set(0.1 * (1 - ads), -0.07 * (1 - ads) - 0.03, -0.9));
  const pellets = W.pellets || 1;
  let hit = false, killed = false, head = false, armor = false;
  for (let k = 0; k < pellets; k++) {
    const a = Math.random() * TAU, m = Math.sqrt(Math.random()) * spread;
    const dir = f.clone().addScaledVector(r, Math.cos(a) * m).addScaledVector(u, Math.sin(a) * m).normalize();
    const res = fireRay(camera.position, dir, W, key, 1);
    hit ||= res.hit; killed ||= res.killed; head ||= res.head; armor ||= res.armor;
    if (k < 3) tracer(muzzle, res.end, 'player');
    if (k === 0) suppressAlong(camera.position, res.end);
  }
  if (hit) {
    run.hits++;
    hitMarker(killed, head);
    if (head) sfx.hitHead(); else if (armor) sfx.hitArmor(); else sfx.hitBody();
  }
  flashLight(_p.copy(camera.position).addScaledVector(f, 1.2), W.pellets ? 90 : 55, 11, 0.06);
  vmFlash.intensity = 2.2;
  weaponState.flashT = 0.045;
  const fl = models[key].flash;
  fl.visible = true; fl.rotation.z = Math.random() * TAU; fl.scale.setScalar(rand(0.8, 1.25));
  // no muzzle smoke for the player's own gun: it would pile up in front of the camera
  const heat = weaponState.heat;
  player.recoilP += W.recoilV * (1 - ads * 0.35) * (1 + Math.min(heat, 12) * 0.035);
  player.recoilY += rand(-1, 1) * W.recoilH + (heat > 5 ? Math.sin(heat * 0.6) * W.recoilH * 1.4 : 0);
  weaponState.heat += 1;
  weaponState.kick = 1;
  weaponState.lastShot = performance.now();
  if (W.pump) { weaponState.pumpT = W.pump; weaponState.pumped = false; sfx.pump(0.14); }
  else ejectCasing(camera.localToWorld(_p.set(0.16 * (1 - ads) + 0.05, -0.1, -0.35)), _e.copy(r).multiplyScalar(rand(1.6, 2.4)).addScaledVector(u, rand(1.3, 2.1)).addScaledVector(f, -0.4).add(player.vel));
  sfx.shot(key);
  scatterBirds();
  noise(player.pos, 48, 'shot');
  updateAmmoHUD();
}

/* ---------- touch auto-fire: fire while the crosshair rests on a visible raider ---------- */
function autoFireCheck() {
  if (!(isTouch && settings.autoFire)) return false;
  raycaster.set(camera.position, _f.set(0, 0, -1).applyQuaternion(camera.quaternion));
  raycaster.near = 0.1; raycaster.far = 70;
  const h = raycaster.intersectObjects(bulletTargets.hostiles(), false)[0];
  return !!(h && h.object.userData.ch && h.object.userData.ch.enemy);
}

/* ---------- per-frame weapon logic and viewmodel pose ---------- */
let switchOffset = 0, autoT = 0;
export function updateArsenal(dt) {
  const key = currentKey(), W = WEAPONS[key], A = inv.ammo[key], ws = weaponState;
  friendlyWarnT -= dt;
  ws.cd -= dt;
  autoT -= dt;
  if (autoT <= 0) { autoT = 0.1; ws.autoFire = game.state === 'playing' && autoFireCheck(); }
  const wantFire = (input.fire || ws.autoFire) && !player.sprinting;
  const canAct = player.alive && !busy();

  if (ws.meleeT > 0) {
    ws.meleeT -= dt;
    if (!ws.meleeHit && MELEE.duration - ws.meleeT >= MELEE.hitAt) { ws.meleeHit = true; doMelee(); }
  }
  // pump action
  if (ws.pumpT > 0) {
    ws.pumpT -= dt;
    if (!ws.pumped && ws.pumpT < W.pump * 0.45) {
      ws.pumped = true;
      ejectCasing(camera.localToWorld(_p.set(0.14, -0.08, -0.4)), _e.set(1.6, 1.8, 0).applyQuaternion(camera.quaternion).add(player.vel), true);
    }
  }
  ws.firing = wantFire && canAct;
  if (wantFire && canAct && ws.cd <= 0 && ws.pumpT <= 0) {
    if (W.auto || !ws.latch) { shoot(); ws.latch = true; }
  } else if (wantFire && ws.shells && ws.reload > 0 && A.mag > 0) {
    ws.reload = 0; ws.shells = false;  // interrupt a shell-by-shell reload to fire
  }
  if (!wantFire) { ws.latch = false; if (performance.now() - ws.lastShot > 220) ws.heat = Math.max(0, ws.heat - dt * 14); }
  const aimWanted = input.aim && player.alive && ws.reload <= 0 && ws.sw <= 0 && !player.sprinting;
  ws.ads += ((aimWanted ? 1 : 0) - ws.ads) * damp(W.adsSpeed || 14, dt);

  // reload
  if (ws.reload > 0) {
    ws.reload -= dt;
    if (ws.shells) {
      if (ws.reload <= 0) {
        if (A.mag < W.mag && A.res > 0) { A.mag++; A.res--; sfx.shell(); updateAmmoHUD(); }
        if (A.mag < W.mag && A.res > 0) ws.reload = W.shellTime;
        else { ws.reload = 0; ws.shells = false; sfx.pump(0.05); }
      }
    } else {
      const p = 1 - ws.reload / ws.reloadDur;
      if (ws.reloadSounds === 0 && p > 0.22) { ws.reloadSounds = 1; sfx.magOut(); }
      if (ws.reloadSounds === 1 && p > 0.62) { ws.reloadSounds = 2; sfx.magIn(); }
      if (ws.reloadSounds === 2 && ws.reloadEmpty && p > 0.86) { ws.reloadSounds = 3; sfx.bolt(); }
      if (ws.reload <= 0) {
        const take = Math.min(W.mag - A.mag, A.res);
        A.mag += take; A.res -= take; ws.reload = 0;
        updateAmmoHUD(true);
      }
    }
  }
  // weapon switch
  if (ws.sw > 0) {
    const before = ws.sw, half = (ws.swDur || 0.5) / 2;
    ws.sw -= dt;
    if (before > half && ws.sw <= half) {
      for (const k in models) models[k].g.visible = false;
      inv.slot = ws.swTo.slot;
      inv.pIndex = ws.swTo.idx;
      models[currentKey()].g.visible = true;
      updateAmmoHUD(true);
    }
    switchOffset = ws.sw > half ? (half * 2 - ws.sw) / half : Math.max(0, ws.sw) / half;
  } else switchOffset = 0;

  // scope: breathing sway, steadied by holding breath (sprint key) at the cost of stamina
  const scoped = W.sight === 'scope' && ws.ads > 0.85;
  ws.scoped = scoped;
  if (scoped) {
    const hold = input.sprint && player.stamina > 0;
    if (hold) player.stamina = Math.max(0, player.stamina - 30 * dt);
    const target = (hold ? 0.0005 : 0.0035 + clamp(player.speed2d / 5, 0, 1) * 0.01) * (player.stamina <= 0 ? 2 : 1);
    ws.scopeSway += (target - ws.scopeSway) * damp(5, dt);
  } else ws.scopeSway += (0 - ws.scopeSway) * damp(8, dt);

  animateViewmodel(dt, key, W, A);
}

function animateViewmodel(dt, key, W, A) {
  const ws = weaponState, M = models[key];
  ws.kick *= Math.exp(-16 * dt);
  ws.flashT -= dt;
  if (ws.flashT <= 0) M.flash.visible = false;
  vmFlash.intensity *= Math.exp(-40 * dt);
  const ads = smooth(ws.ads);
  // aimed in, every positional wobble fades out so the sight stays centred on the point of aim;
  // what remains is a little rotation, which makes the far-projected reticle float in the window
  const loose = 1 - ads * 0.96, rotK = 1 - ads * 0.7;
  const hip = M.hip || (key === 'pistol' ? [0.12, -0.13, -0.32] : [0.15, -0.165, -0.37]);
  const pos = _p.set(hip[0], hip[1], hip[2]).lerp(_e.set(0, -M.sightY, M.adsZ), ads);
  const bobAmt = clamp(player.speed2d / 5, 0, 1.3) * (player.onGround ? 1 : 0) * loose;
  pos.x += Math.sin(player.bobT) * 0.012 * bobAmt;
  pos.y += Math.abs(Math.cos(player.bobT)) * 0.012 * bobAmt - player.land * 0.03 * loose;
  player.swayX += (clamp(-input.swayX * 0.00045, -0.05, 0.05) - player.swayX) * damp(10, dt);
  player.swayY += (clamp(input.swayY * 0.00045, -0.05, 0.05) - player.swayY) * damp(10, dt);
  input.swayX = 0; input.swayY = 0;
  pos.x += player.swayX * loose; pos.y += player.swayY * loose;
  // the gun leans into strafes and floats up a touch while airborne
  const side = (player.vel.x * Math.cos(player.yaw) - player.vel.z * Math.sin(player.yaw)) / 5;
  ws.strafe = (ws.strafe || 0) + (clamp(side, -1, 1) - (ws.strafe || 0)) * damp(6, dt);
  pos.y += clamp(player.vel.y * 0.004, -0.02, 0.02) * loose;
  // recoil: a straight push back at the hip, only a short controlled nudge when aiming
  pos.z += ws.kick * lerp(W.pellets ? 0.08 : key === 'dmr' ? 0.07 : 0.05, 0.012, ads);
  const meleeK = ws.meleeT > 0 ? Math.sin(Math.min(1, (1 - ws.meleeT / MELEE.duration) * 1.3) * Math.PI) : 0;
  ws.mantleK = (ws.mantleK || 0) + ((player.mantle ? 1 : 0) - (ws.mantleK || 0)) * damp(12, dt);
  pos.y -= switchOffset * 0.32 + (playerNade.throwT > 0 || playerNade.cooking ? 0.3 : 0) + meleeK * 0.28 + ws.mantleK * 0.16;
  pos.y += Math.sin(performance.now() * 0.0016) * 0.004 * loose;
  const sprintK = player.sprinting ? 1 : 0;
  ws.sprintK = (ws.sprintK || 0) + (sprintK - (ws.sprintK || 0)) * damp(9, dt);
  pos.y -= ws.sprintK * 0.05; pos.x -= ws.sprintK * 0.03;
  let rx = ws.kick * (W.pellets ? 0.14 : key === 'pistol' ? 0.14 : 0.06) * rotK + player.swayY * 2 * rotK - ws.sprintK * 0.25;
  let rz = player.swayX * 3 * rotK + ws.sprintK * 0.55 - ws.strafe * 0.06 * loose, ry = player.swayX * 2 * rotK + ws.sprintK * 0.4;
  if (ws.reload > 0 && !ws.shells) {
    const p = 1 - ws.reload / ws.reloadDur, tilt = Math.sin(Math.min(1, p * 1.15) * Math.PI);
    rz += tilt * 0.55; rx += tilt * 0.25; pos.y -= tilt * 0.05;
    const mp = p < 0.25 ? 0 : p < 0.45 ? (p - 0.25) / 0.2 : p < 0.62 ? 1 - (p - 0.45) / 0.17 : 0;
    M.mag.position.y = -mp * 0.28;
    M.mag.visible = !(p > 0.43 && p < 0.47);
  } else { M.mag.position.y = 0; M.mag.visible = true; }
  if (ws.shells && ws.reload > 0) {
    rz += 0.35; rx += 0.1;
    const p = 1 - clamp(ws.reload / W.shellTime, 0, 1);
    M.shell.visible = true;
    M.shell.position.set(0.02 - p * 0.02, -0.06 + p * 0.03, 0.02 - p * 0.05);
  } else if (M.shell) M.shell.visible = false;
  if (M.pump) M.pump.position.z = ws.pumpT > 0 ? Math.sin((1 - ws.pumpT / W.pump) * Math.PI) * 0.09 : 0;
  if (M.slide) M.slide.position.z = Math.min(ws.kick * 0.035, 0.03) + (A.mag === 0 && ws.reload <= 0 ? 0.03 : 0);
  // iron sights sit a hair under the point of aim (a six o'clock hold), turned about the eye so the
  // rear and front sights stay lined up: the target stands clear above the front sight
  if (M.hold && ads > 0) { const a = M.hold * ads; pos.applyAxisAngle(X_AXIS, -a); rx -= a; }
  vmRoot.position.copy(pos);
  vmRoot.rotation.set(rx, ry, rz);
  vmRoot.visible = !ws.scoped;
  // the red reticle only shows when looking through the window
  if (M.reticle) M.reticle.material.opacity = clamp((ads - 0.55) / 0.35, 0, 1) * (ws.reload > 0 || ws.sw > 0 ? 0 : 1);

  // grenade in hand
  const pn = playerNade;
  if (pn.cooking || pn.throwT > 0) {
    const p = pn.throwT > 0 ? 1 - pn.throwT / 0.5 : 0;
    nadeHand.visible = p < 0.55;
    nadeHand.position.set(0.12 + p * 0.05, -0.2 + (pn.cooking ? 0.08 : Math.sin(p * Math.PI) * 0.18), -0.3 - p * 0.25);
    nadeHand.rotation.x = -p * 1.4;
  } else nadeHand.visible = false;

  // knife slash from the right shoulder across the view
  if (ws.meleeT > 0) {
    const p = 1 - ws.meleeT / MELEE.duration;
    const s = p < 0.3 ? smooth(p / 0.3) : 1 - smooth((p - 0.3) / 0.7);
    knifeHand.visible = true;
    knifeHand.position.set(0.26 - s * 0.36, -0.14 + s * 0.08, -0.3 - s * 0.16);
    knifeHand.rotation.set(-0.3 + s * 0.2, 0.9 - s * 1.4, 0.4 - s * 0.7);
  } else knifeHand.visible = false;

  const fov = settings.fov * lerp(1, W.zoom, ads);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  const moving = clamp(player.speed2d / 5, 0, 1);
  ws.spreadPx = 6 + (moving * 14 + Math.min(ws.heat, 10) * 1.6 + (player.onGround ? 0 : 16) + (W.pellets ? 16 : 0)) * (1 - ads);
}
