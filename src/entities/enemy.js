import * as THREE from 'three';
import { TAU, clamp, damp, rand, randi, pick, wrapAngle } from '../core/utils.js';
import { radio } from '../audio/radio.js';
import { zoneAt } from '../world/zones.js';
import { scene } from '../core/renderer.js';
import { tod } from '../core/sky.js';
import { world, makeActorBody, driveActor } from '../core/physics.js';
import { enemies, allies, game, grenades } from '../core/state.js';
import { ENEMY, WEAPONS } from '../config/balance.js';
import { TEX } from '../assets/textures.js';
import { slideCircle, supportHeight, surfaceAt } from '../world/collision.js';
import { findPath, isBlocked } from '../world/nav.js';
import { damageProp } from '../world/props.js';
import { fx } from '../fx/particles.js';
import { decal, DMAT, bloodDecal } from '../fx/decals.js';
import { tracer, flashLight } from '../fx/tracers.js';
import { sfx } from '../audio/sfx.js';
import { tensionEvent } from '../systems/tension.js';
import { buildSoldier, animateSoldier } from './soldier-model.js';
import { makeRagdoll } from './ragdoll.js';
import { raycaster, losBlocked, hitNormal, rayCharacter, bulletTargets } from './combat.js';
import { player } from './player.js';
import { throwEnemyGrenade } from '../weapons/grenades.js';
import { onEnemyKilled } from '../systems/waves.js';
import { lastWords } from '../ui/hud.js';

/*
 * Raiders. Roles: rifle (default), grenadier (lobs grenades at players behind cover)
 * and sniper (static on a tower; always telegraphs with a scope glint and a laser before firing).
 * Spawn modes: walk in through a gate, fast-rope from a helicopter, or appear on a tower.
 *
 * Every raider plays like a person rather than a turret. He only knows what he has seen, heard
 * or been told on the squad net; he needs a moment to notice you (longer in the dark, at range,
 * against a crouched or still target) and only looks where he is facing. He sprints between
 * cover, peeks, fires and ducks back, reloads and patches himself up behind cover, moves round
 * your flank while his mates keep you busy, pre-aims the spot where he last saw you, and
 * grenades you out of a hiding place. How well he does all of it comes from the difficulty.
 */

/** Per-wave marksmanship, written by the wave system (already multiplied by difficulty). */
export const waveCfg = { spread: 0.03, react: 1, pause: 1, dmg: 1 };
/** Tactical profile, written by the wave system from DIFFICULTY[..].ai (defaults: veteran). */
export const aiCfg = {
  fov: 160, notice: 0.45, hear: 42, flank: 0.55, flankers: 2, nade: 0.75, nadeGap: 6, heal: 1, cover: 0.92,
  peek: [1.1, 2.2], relocate: 3, settle: 1.7, runGun: true, preaim: 0.85, hop: 0.2, push: 0.6, strafe: 0.9, snipe: 0.95, intel: 1.2,
};

let laserGeo, laserMat, sniperLaserMat, dotMat, flashMat;
export function initEnemies() {
  laserGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 0.35, 0.2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  sniperLaserMat = laserMat.clone();
  dotMat = new THREE.SpriteMaterial({ map: TEX.soft, color: new THREE.Color(9, 0.8, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  flashMat = new THREE.SpriteMaterial({ map: TEX.flash, color: new THREE.Color(5, 3.2, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
}

let serial = 0;

/* ---------- the squad net: shared sightings, the attack front, camping, radio discipline ---------- */
const squad = {
  pos: new THREE.Vector3(), t: 999,          // last sighting passed round the net, and its age
  pending: null, pendingT: 0,                // a sighting still being called in
  guess: new THREE.Vector3(), guessT: 0,     // where they think the defenders hold out, without contact
  camp: 0, campPos: new THREE.Vector3(),     // how long the player has held one spot
  front: new THREE.Vector3(0, 0, -1),        // average bearing from the player to the raiders fighting him
  flankers: 0, nadeT: 0, talkT: 0, lines: {},
};
function resetSquad() {
  Object.assign(squad, { t: 999, pending: null, pendingT: 0, guessT: 0, camp: 0, flankers: 0, nadeT: 4, talkT: 0, lines: {} });
}
function squadSee(pos) {
  if (squad.pending) return;
  squad.pending = pos.clone();
  squad.pendingT = aiCfg.intel ?? 1.2;
}

/* Intercepted raider radio: you hear their plans (and where they think you are) as subtitles. */
const LINES = {
  spot: ['رصدنا الهدف قرب {z}!', 'الهدف في {z}، طوّقوه!', 'إنه عند {z}. أطلقوا النار!', 'تحرّكوا نحو {z}، الهدف هناك!'],
  reload: ['أبدّل المخزن، غطّوني!', 'ذخيرتي نفدت، لحظة!', 'أعيد التذخير!'],
  flank: ['سألتفّ عليه من الجناح، اشغلوه بالنار!', 'غطّوني، أنا ألتفّ من الخلف!', 'أطوّقه من الجهة الأخرى!'],
  nade: ['إنه متحصّن عند {z}، سأخرجه بقنبلة!', 'قنبلة نحو {z}!', 'لا يخرج من مخبئه، ارموا القنابل!'],
  hurt: ['أُصبت! أتراجع لأضمّد جرحي!', 'أنا مصاب، غطّوني!'],
  lost: ['فقدنا أثره، فتّشوا {z}!', 'أين ذهب؟ انتشروا وفتّشوا!'],
  down: ['سقط أحدنا!', 'خسرنا رجلاً، انتبهوا!'],
};
const LINE_GAP = { spot: 16, reload: 20, flank: 16, nade: 14, hurt: 18, lost: 22, down: 18 };
function callout(kind, chance = 1, at = player.pos) {
  const t = performance.now() / 1000;
  if (t < squad.talkT || t < (squad.lines[kind] || 0) || Math.random() > chance) return;
  squad.talkT = t + 6;
  squad.lines[kind] = t + LINE_GAP[kind];
  radio(pick(LINES[kind]).replace('{z}', zoneAt(at.x, at.z)), 'enemy');
}

/* ---------- hearing ---------- */
let lastPlayerShot = -1e9;
/**
 * A sound the raiders may hear: kind 'shot' (gunfire) or 'step' (footsteps). `radius` is the
 * distance a veteran hears it at; the difficulty scales it. Hearing gives a rough position only.
 */
export function noise(pos, radius, kind, fromPlayer = true) {
  if (kind === 'shot' && fromPlayer) lastPlayerShot = performance.now();
  const r = radius * aiCfg.hear / 42;
  for (const e of enemies) {
    if (!e.alive || e.rope) continue;
    const d = e.pos.distanceTo(pos);
    if (d < r) e.hear(pos, d, kind);
  }
}

/* Footsteps of every raider share a small budget so a crowd does not turn into noise. */
let stepBudget = 0, stepBudgetT = 0;
function enemyStep(e, sp) {
  const d = e.pos.distanceTo(player.pos);
  if (d > 30) return;
  const t = performance.now();
  if (t - stepBudgetT > 400) { stepBudgetT = t; stepBudget = 0; }
  if (++stepBudget > 4) return;
  const vol = clamp(sp / 4.5, 0.3, 0.85) * (e.kind === 'heavy' ? 1.25 : 1) * (e.crouch ? 0.5 : 1);
  sfx.stepAt(e.pos, surfaceAt(e.pos.x, e.pos.z, e.pos.y), vol);
}

/* ---------- per-frame budgets for the expensive queries ---------- */
let pathCount = 0, coverCount = 0;
/** A* path, or undefined when this frame's budget is spent (ask again next frame). */
function budgetPath(sx, sz, tx, tz) {
  if (pathCount >= 3) return undefined;
  pathCount++;
  return findPath(sx, sz, tx, tz);
}

/*
 * Cover search: a walkable spot a few metres away where a crouching man is hidden from the
 * threat, plus a firing position (standing up, or a lean out to either side) that sees it.
 * mode 'fight' prefers mid range, 'advance' bounds closer, 'retreat' falls back.
 * Spots already claimed by a squad mate are skipped so the squad spreads out.
 */
const _cv = new THREE.Vector3(), _ct = new THREE.Vector3();
export function findCover(self, threat, mode = 'fight', pool = enemies, anchor = null) {
  if (coverCount >= 2) return null;
  coverCount++;
  const tx = threat.x, tz = threat.z;
  _ct.set(tx, threat.y + 1.45, tz);
  const cur = Math.hypot(self.pos.x - tx, self.pos.z - tz);
  const ox = anchor ? anchor.x : self.pos.x, oz = anchor ? anchor.z : self.pos.z;
  const cands = [];
  const a0 = Math.random() * TAU;
  const radii = mode === 'retreat' ? [3, 6, 9] : [2.5, 4.5, 7];
  for (let k = 0; k < 9; k++) {
    const a = a0 + (k / 9) * TAU;
    for (const r of radii) {
      const x = ox + Math.sin(a) * r, z = oz + Math.cos(a) * r;
      if (isBlocked(x, z)) continue;
      const dT = Math.hypot(x - tx, z - tz);
      if (dT < 6) continue;
      if (mode === 'advance' && dT > cur - 2) continue;
      if (mode === 'retreat' && dT < cur) continue;
      if (pool.some((o) => o !== self && o.alive && o.cover && Math.abs(o.cover.x - x) + Math.abs(o.cover.z - z) < 2.6)) continue;
      const y = supportHeight(x, z, self.pos.y + 0.5, 0.2);
      if (Math.abs(y - self.pos.y) > 0.5) continue;
      const travel = Math.hypot(x - self.pos.x, z - self.pos.z);
      let score = travel * 0.6;
      if (mode === 'fight') score += Math.abs(dT - 17) * 0.25;
      else if (mode === 'advance') score += dT * 0.15;
      else score -= dT * 0.2;
      cands.push({ x, y, z, score });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  let tests = 0;
  for (const c of cands) {
    if (++tests > 10) break;
    if (!losBlocked(_cv.set(c.x, c.y + 1.0, c.z), _ct)) continue;
    let peek = null;
    if (mode !== 'retreat') {
      const px = -(c.z - tz), pz = c.x - tx, pl = Math.hypot(px, pz) || 1;
      for (const s of [0, 0.85, -0.85]) {
        const x = c.x + (px / pl) * s, z = c.z + (pz / pl) * s;
        if (s && isBlocked(x, z)) continue;
        if (!losBlocked(_cv.set(x, c.y + 1.5, z), _ct)) { peek = new THREE.Vector3(x, c.y, z); break; }
      }
      if (!peek) continue;
    }
    return { pos: new THREE.Vector3(c.x, c.y, c.z), peek };
  }
  return null;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _g = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Enemy {
  constructor(kind, role, pos, opts = {}) {
    this.kind = kind;
    this.role = role;
    const def = ENEMY[kind === 'heavy' ? 'heavy' : 'raider'];
    this.def = def;
    this.ch = buildSoldier(kind, randi(1e6), role);
    this.ch.enemy = this;
    this.root = this.ch.root;
    scene.add(this.root);
    this.pos = pos.clone();
    this.vel = this.ch.vel;
    this.yaw = Math.atan2(-pos.x, -pos.z);
    this.alive = true;
    this.maxHp = role === 'sniper' ? ENEMY.sniper.hp : def.hp;
    this.hp = this.maxHp;
    this.name = (kind === 'heavy' ? 'مدرّع ' : role === 'sniper' ? 'قنّاص ' : role === 'grenadier' ? 'رامي قنابل ' : 'غازٍ ') + String(++serial).padStart(2, '0');
    this.path = null; this.pathI = 0; this.repath = 0; this.pathGoal = new THREE.Vector3(1e9, 0, 0);
    this.target = player; this.canSee = false; this.seeT = 0; this.losT = rand(0, 0.2); this.losIv = 0.2; this.notice = 0;
    this.lastSeen = new THREE.Vector3(); this.spotted = 0; this.lastSeenT = 99;
    this.react = rand(0.45, 0.85) * waveCfg.react;
    this.burst = 0; this.fireT = rand(0.4, 1.1);
    this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(1, 2.5);
    this.flinch = 0; this.kick = 0; this.pitch = 0; this.flashT = 0; this.limp = 0; this.throwT = 0;
    this.nadeT = rand(...ENEMY.grenadier.cooldown) * 0.5;
    this.nades = role === 'grenadier' ? 99 : Math.random() < aiCfg.nade ? 1 : 0;
    this.charge = 0; this.glinted = false;
    this.speed = def.speed;
    this.magMax = kind === 'heavy' ? 60 : role === 'grenadier' ? 20 : 30;
    this.mag = randi(this.magMax * 0.5) + Math.ceil(this.magMax * 0.5);
    this.reloadT = 0; this.stepD = 0; this.suppr = 0; this.crouch = false; this.sprinting = false;
    // tactics
    this.state = 'advance'; this.stateT = 0; this.think = rand(0, 0.3);
    this.goal = new THREE.Vector3(); this.slot = rand(0, TAU); this.slotR = rand(2.5, 6);
    this.cover = null; this.peekPos = null; this.coverState = ''; this.coverT = 0; this.coverCD = rand(0.5, 2); this.peeks = 0;
    this.flankPos = null; this.flankCD = rand(3, 8); this.searchDur = 2; this.searchYaw = 0;
    this.heals = aiCfg.heal; this.healing = 0; this.exposedT = 0; this.evadeFrom = new THREE.Vector3();
    this.hopY = 0; this.hopV = 0; this.crouchWalk = 0; this.stuckT = 0; this.stuckP = pos.clone(); this.preaimRoll = Math.random();
    this.rope = opts.rope || null;            // { y0, heli }
    this.static = role === 'sniper';
    this.body = makeActorBody();
    this.laser = new THREE.Mesh(laserGeo, role === 'sniper' ? sniperLaserMat : laserMat);
    this.laser.frustumCulled = false; this.laser.visible = false;
    scene.add(this.laser);
    this.dot = new THREE.Sprite(dotMat); this.dot.scale.set(0.14, 0.14, 1); this.dot.visible = false;
    scene.add(this.dot);
    this.mflash = new THREE.Sprite(flashMat); this.mflash.scale.set(0.45, 0.45, 1); this.mflash.visible = false;
    this.ch.muzzle.add(this.mflash);
    this.laserLen = 30; this.laserT = 0;
    if (this.rope) this.pos.y = this.rope.y0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.pickGoal();
  }
  /** He knows exactly where the shot came from (he was hit, or he landed right on top of the fight). */
  alert(at = player.pos) { this.spotted = 3; this.lastSeen.copy(at); this.lastSeenT = 0; this.notice = Math.max(this.notice, 0.8); this.think = 0; }
  /** A rough position from gunfire or footsteps: go and look. */
  hear(pos, d, kind) {
    if (this.canSee || this.static) return;
    const err = d * (kind === 'shot' ? 0.07 : 0.1) + 1;
    if (this.lastSeenT < 1.5 && this.lastSeen.distanceTo(pos) < err * 2) return;
    this.lastSeen.set(pos.x + rand(-err, err), 0, pos.z + rand(-err, err));
    this.lastSeenT = Math.min(this.lastSeenT, kind === 'shot' ? 1.5 : 3);
    this.notice = Math.max(this.notice, 0.4);
    if (this.state === 'advance' || this.state === 'search') this.think = 0;
  }
  /** A round passed close by: raiders under fire aim worse, react slower and look for cover. */
  suppress(amount) {
    if (!this.alive) return;
    this.suppr = Math.min(1.5, this.suppr + amount);
    if (this.spotted <= 0) this.alert();
  }
  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  /** Sight: field of view, line of sight, and the moment it takes to notice someone. */
  chooseTarget(eye, el) {
    const cands = [player];
    for (const a of allies) if (a.alive && a.landed) cands.push(a);
    let best = null, bestD = Infinity;
    const range = (this.static ? ENEMY.sniper.range : 80) * (1 - game.storm * 0.6);
    const halfFov = this.static ? 4 : (aiCfg.fov * Math.PI) / 360;
    for (const c of cands) {
      if (!c.alive) continue;
      const tp = _b.set(c.pos.x, c.pos.y + c.eyeH - 0.2, c.pos.z);
      const d = eye.distanceTo(tp), w = d * (c === player ? 1 : 1.2);
      if (d > range || w > bestD) continue;
      const tracking = c === this.target && this.lastSeenT < 2;
      if (!tracking && d > 4 && Math.abs(wrapAngle(Math.atan2(tp.x - eye.x, tp.z - eye.z) - this.yaw)) > halfFov) continue;
      if (losBlocked(eye, tp)) continue;
      best = c; bestD = w;
    }
    if (best && this.notice < 1) {
      const d = best.pos.distanceTo(this.pos);
      let vis = 1 / (0.3 + d / 20);
      if (best.crouch) vis *= 0.6;
      if ((best.speed2d || 0) > 3.5) vis *= 1.4;
      if (tod.night > 0.5 && !(best === player && player.torch)) vis *= 0.5;
      if (best === player && performance.now() - lastPlayerShot < 1500) vis *= 3;
      if (this.static) vis *= 1.5;
      const warned = this.spotted > 0 || this.lastSeenT < 8 ? 4 : 1;
      this.notice += (el * vis * warned) / aiCfg.notice;
      if (this.notice < 1) best = null;
    } else if (!best) this.notice = Math.max(0, this.notice - el * 0.3);
    const saw = this.canSee;
    this.canSee = !!best;
    if (best) this.target = best;
    else if (!this.target || !this.target.alive) this.target = player;
    // pre-aimed at the spot he appears: the first shot comes much sooner
    if (this.canSee && !saw) {
      const off = Math.abs(wrapAngle(Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z) - this.yaw));
      this.seeT = off < 0.3 && this.preaimRoll < aiCfg.preaim ? this.react * 0.5 : 0;
      if (best === player) callout('spot', 0.6);
    }
  }

  update(dt) {
    if (!this.alive) return;
    if (this.rope) { this.updateRope(dt); return; }
    const eye = _a.set(this.pos.x, this.pos.y + this.hopY + (this.crouch ? 1.05 : 1.55), this.pos.z);
    this.losT -= dt;
    if (this.losT <= 0) {
      const el = this.losIv;
      this.losIv = this.losT = 0.16 + Math.random() * 0.1;
      this.chooseTarget(eye, el);
    }
    const T = this.target;
    const tp = _c.set(T.pos.x, T.pos.y + T.eyeH - 0.2, T.pos.z);
    const toT = _d.subVectors(tp, eye);
    const dist = toT.length();
    this.lastSeenT += dt;
    if (this.canSee) {
      this.seeT += dt; this.lastSeen.copy(T.pos); this.spotted = 2.5; this.lastSeenT = 0;
      if (T === player) squadSee(T.pos);
    } else {
      this.seeT = 0; this.spotted -= dt;
      // the squad net: a mate's fresher sighting (a little vague by the time it reaches him)
      if (squad.t + 0.5 < this.lastSeenT && !this.static) {
        this.lastSeen.set(squad.pos.x + rand(-1.5, 1.5), 0, squad.pos.z + rand(-1.5, 1.5));
        this.lastSeenT = squad.t;
      }
    }

    if (this.static) this.updateSniper(dt, dist, toT);
    else this.updateMover(dt, dist, toT);

    this.flinch *= Math.exp(-8 * dt);
    this.kick *= Math.exp(-14 * dt);
    this.suppr = Math.max(0, this.suppr - dt * 0.4);
    this.limp = Math.max(0, this.limp - dt);
    this.flashT -= dt;
    this.mflash.visible = this.flashT > 0;
    if (this.throwT > 0) this.throwT -= dt;
    // a sideways hop when dodging fire in the open
    if (this.hopV || this.hopY > 0) {
      this.hopY += this.hopV * dt; this.hopV -= 16 * dt;
      if (this.hopY <= 0) { this.hopY = 0; this.hopV = 0; }
    }
    this.root.position.set(this.pos.x, this.pos.y + this.hopY, this.pos.z);
    this.root.rotation.y = this.yaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.stepD += sp * dt;
    if (this.stepD > (sp > 3.4 ? 1.55 : 1.2)) { this.stepD = 0; if (this.hopY <= 0) enemyStep(this, sp); }
    animateSoldier(this.ch, dt, {
      vel: this.vel, yaw: this.yaw, crouch: this.crouch, pitch: this.pitch, flinch: this.flinch, kick: this.kick,
      throw: this.throwT > 0 ? Math.sin((1 - this.throwT / 0.7) * Math.PI) : 0,
      sprint: this.sprinting && !this.canSee, air: this.hopY > 0.04, ready: this.canSee || this.lastSeenT < 4 || this.static ? 1 : 0,
    });
    driveActor(this.body, this.pos, this.vel);
    this.updateLaser(dt);
  }

  updateRope(dt) {
    const r = this.rope;
    this.pos.y -= dt * 4.2;
    const ground = supportHeight(this.pos.x, this.pos.z, this.pos.y + 0.5);
    this.vel.set(0, -4.2, 0);
    this.yaw += dt * 0.4;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.rope = null;
      this.vel.set(0, 0, 0);
      this.alert();
      this.setState('hunt');
      if (r.onLand) r.onLand(this);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    animateSoldier(this.ch, dt, { rope: true });
    driveActor(this.body, this.pos, this.vel);
    this.laser.visible = this.dot.visible = false;
  }

  /** Where to head without contact: the squad's last sighting, or their idea of where the defenders hold out. */
  pickGoal() {
    let base;
    if (squad.t < 20) base = squad.pos;
    else {
      if (squad.guessT <= 0) { const a = rand(0, TAU), r = rand(4, 11); squad.guess.set(player.pos.x + Math.sin(a) * r, 0, player.pos.z + Math.cos(a) * r); squad.guessT = 15; }
      base = squad.guess;
    }
    this.goal.set(clamp(base.x + Math.sin(this.slot) * this.slotR, -44, 44), 0, clamp(base.z + Math.cos(this.slot) * this.slotR, -44, 44));
  }
  /** Walk a path to `goal`; returns true on arrival. `direct` moves straight (short steps in cover). */
  follow(goal, speed, desired, direct = false) {
    const dx0 = goal.x - this.pos.x, dz0 = goal.z - this.pos.z, d0 = Math.hypot(dx0, dz0);
    if (d0 < 0.7) return true;
    if (direct || d0 < 1.6) { desired.set((dx0 / d0) * speed, 0, (dz0 / d0) * speed); return false; }
    if (!this.path || this.repath <= 0 || this.pathGoal.distanceToSquared(goal) > 2.25) {
      const p = budgetPath(this.pos.x, this.pos.z, goal.x, goal.z);
      if (p !== undefined) { this.path = p; this.pathI = 1; this.pathGoal.copy(goal); this.repath = rand(1.4, 2.4); }
    }
    if (this.path && this.pathI < this.path.length) {
      const wp = this.path[this.pathI], dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.6) this.pathI++;
      else desired.set((dx / d) * speed, 0, (dz / d) * speed);
      return false;
    }
    // path exhausted: close enough to where the grid lets him go
    return !!this.path || d0 < 2;
  }
  takeCover(mode) {
    const c = findCover(this, this.target.pos, mode);
    if (!c) return false;
    this.cover = c.pos; this.peekPos = c.peek; this.coverState = 'move'; this.coverT = 8; this.peeks = 0;
    this.path = null; this.repath = 0;
    this.setState(mode === 'retreat' ? 'retreat' : 'cover');
    return true;
  }
  leaveCover() {
    this.cover = null; this.peekPos = null; this.coverState = '';
    this.setState(this.canSee ? 'fight' : 'hunt');
    this.coverCD = rand(0.8, 2.2);
  }
  canFlank() {
    if (this.flankCD > 0 || squad.flankers >= aiCfg.flankers || squad.t > 8 || this.role === 'grenadier') return false;
    return Math.random() < aiCfg.flank;
  }
  /** Circle round to the side (or behind) of where the player was seen, away from the squad's front. */
  startFlank() {
    this.flankCD = rand(8, 14);
    const c = squad.pos, front = Math.atan2(squad.front.x, squad.front.z);
    for (let k = 0; k < 6; k++) {
      const ang = front + (Math.random() < 0.5 ? -1 : 1) * rand(1.4, 2.4), r = rand(9, 15);
      const x = c.x + Math.sin(ang) * r, z = c.z + Math.cos(ang) * r;
      if (Math.abs(x) > 44 || Math.abs(z) > 44 || isBlocked(x, z)) continue;
      const p = budgetPath(this.pos.x, this.pos.z, x, z);
      if (!p || p.length < 2) continue;
      let len = 0;
      for (let i = 1; i < p.length; i++) len += p[i].distanceTo(p[i - 1]);
      if (len > 75) continue;
      this.flankPos = new THREE.Vector3(x, 0, z);
      this.path = p; this.pathI = 1; this.pathGoal.copy(this.flankPos); this.repath = 4;
      this.setState('flank');
      squad.flankers++;
      callout('flank', 0.55, this.pos);
      tensionEvent('assault');
      return true;
    }
    return false;
  }
  /** One of the player's grenades is about to go off close by. */
  nadeNear() {
    for (const g of grenades) {
      if (g.hostile || g.fuse > 2.4) continue;
      const p = g.m.position;
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 6.5) return p;
    }
    return null;
  }
  /** A squad mate stands in the line of fire. */
  friendInLine(toT, dist) {
    const hx = toT.x / dist, hz = toT.z / dist;
    for (const o of enemies) {
      if (o === this || !o.alive) continue;
      const px = o.pos.x - this.pos.x, pz = o.pos.z - this.pos.z, t = px * hx + pz * hz;
      if (t < 0.5 || t > dist - 0.5) continue;
      if (Math.abs(px * hz - pz * hx) < 0.6) return true;
    }
    return false;
  }
  startReload() {
    this.reloadT = this.kind === 'heavy' ? 3.4 : 2.4;
    this.burst = 0;
    sfx.reloadAt(this.pos.clone().setY(this.pos.y + 1.2));
    callout('reload', 0.3, this.pos);
  }

  /** Re-read the situation a few times a second and pick what to do next. */
  decide(dist) {
    const A = aiCfg, heavy = this.kind === 'heavy', st = this.state;
    if (st === 'evade' && this.stateT < 1.4) return;
    const nade = this.nadeNear();
    if (nade) { this.evadeFrom.copy(nade); this.cover = null; this.coverState = ''; this.setState('evade'); return; }
    if (st === 'retreat' && (this.coverState === 'move' || this.healing > 0)) return;
    if (this.canSee) {
      if (this.hp < this.maxHp * 0.38 && this.heals > 0 && !heavy && this.takeCover('retreat')) { this.heals--; callout('hurt', 0.6, this.pos); tensionEvent('retreat'); return; }
      if ((st === 'cover' || st === 'retreat') && this.cover) return;
      // a flanker keeps going (firing on the move) until he is close or has worked his way round
      if (st === 'flank' && this.flankPos && dist > 11 && this.stateT < 9) return;
      if (heavy) { if (st !== 'push') tensionEvent('assault'); this.setState('push'); return; }
      // standing in the open is how you die: get behind something, then fight from there
      const want = this.suppr > 0.6 || this.reloadT > 0 || (dist > 8 && (st !== 'fight' || this.exposedT > rand(1.4, 3.2)));
      if (want && this.coverCD <= 0 && Math.random() < A.cover) {
        this.coverCD = rand(1.2, 2.5);
        if (this.takeCover(dist > 24 && Math.random() < A.push ? 'advance' : 'fight')) return;
      }
      if (st !== 'fight') { this.setState('fight'); this.exposedT = 0; }
      return;
    }
    // no line of sight
    if ((st === 'cover' || st === 'retreat') && this.cover && (this.lastSeenT < 3.5 || this.coverState === 'move')) return;
    if (st === 'flank' && this.flankPos && this.stateT < 14) return;
    if (st === 'search' && this.stateT < this.searchDur) return;
    if (st === 'evade') { this.setState('hunt'); return; }
    if (this.cover) { this.cover = null; this.peekPos = null; this.coverState = ''; }
    if (this.lastSeenT < 10) {
      if (!heavy && st !== 'hunt' && this.pos.distanceTo(this.lastSeen) > 13 && this.canFlank() && this.startFlank()) return;
      if (st !== 'hunt') { this.setState('hunt'); if (this.lastSeenT > 4) callout('lost', 0.3, this.lastSeen); }
      return;
    }
    if (st !== 'advance') { this.setState('advance'); this.pickGoal(); }
    else if (this.stateT > 14) { this.pickGoal(); this.stateT = 0; }
  }

  updateMover(dt, dist, toT) {
    const A = aiCfg, T = this.target, heavy = this.kind === 'heavy';
    this.stateT += dt;
    this.coverCD -= dt; this.flankCD -= dt; this.nadeT -= dt; this.repath -= dt;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = this.magMax; }
    if (this.healing > 0) {
      // a field dressing behind cover
      this.healing -= dt;
      this.hp = Math.min(this.maxHp * 0.72, this.hp + this.maxHp * 0.11 * dt);
    }
    this.think -= dt;
    if (this.think <= 0) { this.think = rand(0.22, 0.4); this.decide(dist); }
    this.crouch = false;
    this.sprinting = false;
    const desired = _e.set(0, 0, 0);
    const pace = this.limp > 0 ? 0.55 : 1;
    const run = this.speed * pace, sprint = this.speed * (heavy ? 1.1 : 1.35) * pace, walk = Math.min(1.9, run);
    let face = null;
    const toLast = () => Math.atan2(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);

    switch (this.state) {
      case 'advance': {
        const near = this.pos.distanceTo(this.goal) < 14;
        if (this.follow(this.goal, near && this.spotted <= 0 ? run * 0.7 : run, desired)) { this.setState('search'); this.searchDur = rand(1.6, 3); this.searchYaw = this.yaw; }
        // eyes on the last known position while closing in, instead of on his boots
        if (this.lastSeenT < 25 && this.pos.distanceTo(this.lastSeen) < 30 && this.preaimRoll < A.preaim) face = toLast();
        break;
      }
      case 'hunt': {
        const goal = _g.set(this.lastSeen.x + Math.sin(this.slot) * 1.8, 0, this.lastSeen.z + Math.cos(this.slot) * 1.8);
        const far = this.pos.distanceTo(goal) > 12;
        if (this.follow(goal, far ? run : walk, desired)) { this.setState('search'); this.searchDur = rand(1.8, 3.2); this.searchYaw = toLast(); }
        if (!far && Math.random() < dt * 0.3 * A.preaim) this.crouchWalk = rand(1, 2.5);
        if (this.crouchWalk > 0) { this.crouchWalk -= dt; this.crouch = true; desired.multiplyScalar(0.6); }
        face = toLast();
        break;
      }
      case 'search': {
        // sweep the area with the rifle up; then the lead is considered cold
        face = this.searchYaw + Math.sin(this.stateT * 1.4) * 1.1;
        if (this.stateT >= this.searchDur) { this.lastSeenT = Math.max(this.lastSeenT, 10); this.think = 0; }
        break;
      }
      case 'flank': {
        this.sprinting = true;
        if (!this.flankPos || this.follow(this.flankPos, sprint, desired)) { this.flankPos = null; this.setState('hunt'); }
        break;
      }
      case 'fight': {
        this.exposedT += dt;
        this.strafeT -= dt;
        if (this.strafeT <= 0 || (this.canSee && this.friendInLine(toT, dist) && this.strafe === 0)) {
          this.strafeT = rand(0.5, 1.6) / (0.4 + A.strafe);
          this.strafe = Math.random() < 0.25 ? 0 : Math.random() < 0.5 ? -1 : 1;
          if (this.strafe && this.suppr > 0.3 && Math.random() < A.hop && this.hopY <= 0) this.hopV = 3.6;
        }
        const fx0 = toT.x / dist, fz0 = toT.z / dist;
        desired.set(-fz0 * this.strafe, 0, fx0 * this.strafe).multiplyScalar(run * 0.55);
        if (dist > 24) { desired.x += fx0 * run * 0.5; desired.z += fz0 * run * 0.5; }
        if (dist < 7) { desired.x -= fx0 * run * 0.5; desired.z -= fz0 * run * 0.5; }
        // holding still at range he drops to a knee to steady his aim
        this.crouch = this.strafe === 0 && dist > 16;
        if (this.crouch) desired.set(0, 0, 0);
        if (!this.canSee) face = toLast();
        break;
      }
      case 'push': {
        // the armoured man walks straight at you, firing
        const fx0 = toT.x / dist, fz0 = toT.z / dist;
        if (dist > 9) desired.set(fx0 * run * 0.75, 0, fz0 * run * 0.75);
        else { this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = rand(1, 2); this.strafe = Math.random() < 0.5 ? -1 : 1; } desired.set(-fz0 * this.strafe * 1.2, 0, fx0 * this.strafe * 1.2); }
        if (!this.canSee) { this.setState('hunt'); }
        break;
      }
      case 'cover': case 'retreat':
        this.runCover(dt, dist, desired, sprint);
        if (!this.canSee && this.lastSeenT < 6) face = toLast();
        break;
      case 'evade': {
        this.sprinting = true;
        const dx = this.pos.x - this.evadeFrom.x, dz = this.pos.z - this.evadeFrom.z, d = Math.hypot(dx, dz) || 1;
        desired.set((dx / d) * sprint, 0, (dz / d) * sprint);
        break;
      }
      default: this.setState('advance');
    }

    // keep apart: a squad that bunches up dies to one grenade
    for (const o of enemies) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 4.8 && d2 > 1e-4) { const d = Math.sqrt(d2), k = (2.2 - d) * 1.6; desired.x += (dx / d) * k; desired.z += (dz / d) * k; }
    }
    const accel = this.sprinting ? 6 : 8;
    this.vel.x += (desired.x - this.vel.x) * damp(accel, dt);
    this.vel.z += (desired.z - this.vel.z) * damp(accel, dt);
    slideCircle(this.pos, this.vel.x * dt, this.vel.z * dt, 0.38, 1.75);
    const sup = supportHeight(this.pos.x, this.pos.z, this.pos.y + 0.45, 0.2);
    this.pos.y += (sup - this.pos.y) * damp(12, dt);

    // stuck against something: throw the path away and try again
    if (Math.hypot(desired.x, desired.z) > 1.2) {
      this.stuckT += dt;
      if (this.stuckT > 1.6) {
        if (this.pos.distanceTo(this.stuckP) < 0.4) { this.path = null; this.repath = 0; this.slot = rand(0, TAU); this.strafe = -this.strafe; if (this.state === 'advance') this.pickGoal(); }
        this.stuckT = 0; this.stuckP.copy(this.pos);
      }
    } else { this.stuckT = 0; this.stuckP.copy(this.pos); }

    const sp = Math.hypot(this.vel.x, this.vel.z);
    const faceYaw = this.canSee ? Math.atan2(toT.x, toT.z) : face !== null ? face : sp > 0.4 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
    this.yaw += wrapAngle(faceYaw - this.yaw) * damp(this.canSee ? 10 : 6, dt);
    const tpitch = this.canSee ? Math.atan2(toT.y + 0.35, Math.hypot(toT.x, toT.z)) : 0;
    this.pitch += (tpitch - this.pitch) * damp(6, dt);

    this.tryGrenade(dist);
    // fire discipline: facing him, past the reaction time, nobody of his own in the way
    const hiding = (this.state === 'cover' || this.state === 'retreat') && this.coverState !== 'peek';
    const onTheRun = sp > 2.2 && !A.runGun && this.state !== 'fight';
    if (this.canSee && dist < 60 && !hiding && !onTheRun && this.state !== 'evade' && (this.state !== 'flank' || A.runGun)
      && this.reloadT <= 0 && this.healing <= 0 && this.throwT <= 0 && T.alive
      && Math.abs(wrapAngle(Math.atan2(toT.x, toT.z) - this.yaw)) < 0.35 && this.seeT > this.react * (1 + this.suppr * 0.8)) {
      this.fireT -= dt;
      if (this.fireT <= 0 && !this.friendInLine(toT, dist)) {
        if (this.burst <= 0) this.burst = randi(this.def.burst[1] - this.def.burst[0] + 1) + this.def.burst[0];
        this.fire(dist, false);
        this.burst--;
        this.fireT = this.burst > 0 ? this.def.rof : rand(0.5, 1.2) * waveCfg.pause;
      }
    }
  }

  /** Cover cycle: sprint there → crouch (reload, patch up) → step out and fire → duck back, or move on. */
  runCover(dt, dist, desired, sprint) {
    const A = aiCfg;
    this.coverT -= dt;
    if (this.coverState === 'move') {
      this.sprinting = true;
      if (this.follow(this.cover, sprint, desired)) {
        this.coverState = 'hide';
        this.coverT = rand(0.6, 1.4);
        if (this.state === 'retreat') this.healing = 3.2;
      } else if (this.coverT <= 0) this.leaveCover();
      return;
    }
    const spot = this.coverState === 'peek' && this.peekPos ? this.peekPos : this.cover;
    this.follow(spot, 2.4, desired, true);
    if (this.coverState === 'hide') {
      this.crouch = true;
      if (this.mag < this.magMax * 0.55 && this.reloadT <= 0) this.startReload();
      if (this.coverT <= 0 && this.reloadT <= 0 && this.healing <= 0) {
        // patched up behind a wall with no firing line: go and find a fighting position
        if (!this.peekPos) { this.leaveCover(); return; }
        this.coverState = 'peek';
        this.coverT = rand(A.peek[0], A.peek[1]);
        this.peeks++;
      }
    } else {
      const done = this.coverT <= 0 || this.reloadT > 0 || this.suppr > 0.85;
      if (done) {
        if (this.peeks >= A.relocate || dist < 7 || (!this.canSee && this.lastSeenT > 2.5)) this.leaveCover();
        else { this.coverState = 'hide'; this.coverT = rand(0.6, 1.5) * (this.suppr > 0.85 ? 1.6 : 1); }
      }
    }
  }

  /** Grenades for a player who hides behind cover or camps one spot. */
  tryGrenade(dist) {
    const T = this.target;
    if (this.nades <= 0 || this.nadeT > 0 || squad.nadeT > 0 || !T.alive || this.throwT > 0) return;
    const hidden = !this.canSee && this.lastSeenT > 0.6 && this.lastSeenT < 6;
    const camping = squad.camp > 6 && this.lastSeenT < 12;
    if (!hidden && !camping) return;
    const lr = ENEMY.grenadier.range, ld = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
    if (ld < Math.max(7, lr[0]) || ld > lr[1]) return;
    if (enemies.some((o) => o !== this && o.alive && o.pos.distanceTo(this.lastSeen) < 5)) return;
    this.nades--;
    this.nadeT = this.role === 'grenadier' ? rand(...ENEMY.grenadier.cooldown) : 999;
    squad.nadeT = aiCfg.nadeGap;
    this.throwT = 0.7;
    const err = 2.2 - aiCfg.settle * 0.5;
    const aim = this.lastSeen.clone().add(_b.set(rand(-err, err), 0, rand(-err, err)));
    aim.y = supportHeight(aim.x, aim.z, this.lastSeen.y + 1);
    callout('nade', 0.45, aim);
    setTimeout(() => { if (this.alive) throwEnemyGrenade(this.ch.segs.lArmR.group.getWorldPosition(new THREE.Vector3()), aim); }, 330);
  }

  updateSniper(dt, dist, toT) {
    const S = ENEMY.sniper, T = this.target, charge = S.charge * aiCfg.snipe;
    this.vel.set(0, 0, 0);
    if (this.canSee) {
      this.yaw += wrapAngle(Math.atan2(toT.x, toT.z) - this.yaw) * damp(4, dt);
      this.pitch += (Math.atan2(toT.y + 0.35, Math.hypot(toT.x, toT.z)) - this.pitch) * damp(4, dt);
      if (this.charge >= 0 && !this.glinted) { this.glinted = true; sfx.glint(this.pos); }
      this.charge += dt;
      if (this.charge >= charge && T.alive) {
        this.fire(dist, true);
        this.charge = -S.cooldown;
        this.glinted = false;
      }
    } else {
      if (this.charge > 0) this.charge = Math.max(0, this.charge - dt * 2);
      if (this.charge <= 0) this.glinted = false;
      // scan slowly, and watch the last place he saw someone
      const scan = this.lastSeenT < 8 ? Math.atan2(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z) : this.yaw + Math.sin(performance.now() * 0.0004 + this.pos.x) * 0.6;
      this.yaw += wrapAngle(scan - this.yaw) * damp(this.lastSeenT < 8 ? 2 : 0.5, dt);
      if (this.charge < 0) this.charge += dt;
    }
    const k = this.charge > 0 ? clamp(this.charge / charge, 0, 1) : 0;
    const g = this.ch.glint;
    if (g) {
      const s = k > 0 ? (0.5 + k * 1.3) * (0.85 + Math.sin(performance.now() * 0.03) * 0.15) : 0.001;
      g.scale.set(s, s, 1);
      g.material.opacity = k > 0 ? 0.5 + k * 0.5 : 0;
    }
  }

  fire(dist, sniperShot) {
    if (!sniperShot && --this.mag <= 0) this.startReload();
    const T = this.target, mz = this.ch.muzzle.getWorldPosition(_a);
    const aimP = _b.set(T.pos.x, T.pos.y + T.eyeH * 0.72, T.pos.z);
    let spread;
    if (sniperShot) spread = 0.004 + (T.speed2d || 0) * 0.0032;
    else {
      // the first rounds after he acquires you go wide; he settles in if you stay exposed
      const settle = 1 + 1.3 * Math.exp(-this.seeT * aiCfg.settle);
      const moving = Math.hypot(this.vel.x, this.vel.z) > 2 ? 1.7 : 1;
      spread = waveCfg.spread * (1 + dist / 26) * settle * moving * (this.crouch ? 0.8 : 1) + (T.speed2d || 0) * 0.0055 - (T.crouch ? 0.005 : 0);
    }
    spread = Math.max(0.002, spread) * (1 + game.storm * 0.8) * (1 + this.suppr * 1.2);
    const dir = _c.subVectors(aimP, mz).normalize();
    dir.x += rand(-1, 1) * spread; dir.y += rand(-1, 1) * spread * 0.7; dir.z += rand(-1, 1) * spread;
    dir.normalize();
    raycaster.set(mz, dir); raycaster.near = 0; raycaster.far = 180;
    const hits = raycaster.intersectObjects(bulletTargets.world(), false);
    const wd = hits.length ? hits[0].distance : 180;
    const td = rayCharacter(mz, dir, T);
    let end;
    if (td >= 0 && td < wd) {
      end = _d.copy(mz).addScaledVector(dir, td);
      const dmg = (sniperShot ? ENEMY.sniper.dmg : this.def.dmg) * waveCfg.dmg;
      T.hurt(dmg, this.pos, false, sniperShot ? `${this.name} من البرج` : this.name);
    } else {
      end = hits.length ? hits[0].point : _d.copy(mz).addScaledVector(dir, 180);
      if (hits.length && hits[0].point.distanceTo(player.pos) < 35) {
        const h = hits[0], prop = h.object.userData.prop, n = hitNormal(h);
        fx.impact(h.point, n, h.object.userData.surface || 'stone');
        if (prop) damageProp(prop, 8, h.point, dir, 1.2);
        else decal(h.point, n, DMAT.hole, rand(0.1, 0.14));
      }
      // rounds passing close crack past the player's ear
      const hx = player.pos.x - mz.x, hz = player.pos.z - mz.z, t = hx * dir.x + hz * dir.z;
      if (t > 0 && t < wd) {
        const cx = mz.x + dir.x * t, cz = mz.z + dir.z * t;
        if (Math.hypot(cx - player.pos.x, cz - player.pos.z) < 1.6) {
          sfx.whiz(_e.set(cx, player.pos.y + 1.5, cz)); sfx.crack(_e);
          player.suppress = Math.min(1.2, (player.suppress || 0) + (sniperShot ? 0.6 : 0.22));
        }
      }
    }
    tracer(mz, end, 'enemy');
    flashLight(mz, sniperShot ? 80 : 40, 9, 0.07);
    sfx.shot(sniperShot ? 'sniper' : this.kind === 'heavy' ? 'heavy' : 'enemy', mz);
    fx.muzzleSmoke(mz, dir);
    this.kick = 1;
    this.flashT = 0.05;
    this.mflash.material.rotation = Math.random() * TAU;
  }

  updateLaser(dt) {
    const sniperOn = this.static && this.charge > 0;
    const on = sniperOn || (tod.night > 0.35 && !this.static);
    this.laser.visible = on; this.dot.visible = on;
    if (!on) return;
    const o = this.ch.laser.getWorldPosition(_a);
    const dir = _b.set(0, 0, 1).applyQuaternion(this.ch.rifle.getWorldQuaternion(_q));
    this.laserT -= dt;
    if (this.laserT <= 0) {
      this.laserT = 0.08;
      raycaster.set(o, dir); raycaster.near = 0; raycaster.far = 140;
      const h = raycaster.intersectObjects(bulletTargets.world(), false);
      this.laserLen = h.length ? h[0].distance : 140;
      const pc = rayCharacter(o, dir, player);
      if (pc >= 0 && pc < this.laserLen) this.laserLen = pc;
    }
    this.laser.position.copy(o);
    this.laser.lookAt(_c.copy(o).add(dir));
    this.laser.scale.set(0.012, 0.012, this.laserLen);
    if (sniperOn) this.laser.material.opacity = 0.12 + (this.charge / (ENEMY.sniper.charge * aiCfg.snipe)) * 0.35;
    this.dot.position.copy(o).addScaledVector(dir, this.laserLen - 0.04);
  }

  takeDamage(amount, part, point, dir, weapon, impulse = 60, explosive = false) {
    if (!this.alive) return false;
    const W = WEAPONS[weapon];
    let mult = part === 'head' ? this.def.headMul : part === 'torso' ? (W && W.ap ? 1 : this.def.torsoMul || 1) : 0.72;
    if (explosive) mult = 1;
    const dealt = amount * mult;
    this.hp -= dealt;
    this.flinch = 1;
    if (part === 'leg') this.limp = 3;
    this.alert(weapon === 'ally' && allies[0] ? allies[0].pos : player.pos);
    // a heavy hit that does not kill still staggers him and spoils his aim
    if (dealt >= 45 && this.hp > 0) {
      this.flinch = 1.6;
      this.fireT = Math.max(this.fireT, 0.45);
      this.burst = 0;
      this.suppr = Math.min(1.5, this.suppr + 0.6);
      this.seeT = Math.min(this.seeT, this.react * 0.6);
      if (this.charge > 0) this.charge *= 0.4;
    }
    if (!explosive) {
      fx.blood(point, dir, part === 'head' ? 1.5 : 1);
      raycaster.set(point, dir); raycaster.near = 0; raycaster.far = 3.2;
      const h = raycaster.intersectObjects(bulletTargets.world(), false);
      if (h.length) bloodDecal(h[0].point, hitNormal(h[0]), rand(0.55, 1.1) * (part === 'head' ? 1.3 : 1));
      else {
        const x = point.x + dir.x * rand(0.6, 1.8), z = point.z + dir.z * rand(0.6, 1.8);
        bloodDecal(_e.set(x, supportHeight(x, z, point.y), z), _d.set(0, 1, 0), rand(0.45, 0.9));
      }
    }
    if (this.hp <= 0) { this.die(part, point, dir, weapon, impulse, explosive); return true; }
    return false;
  }
  die(part, point, dir, weapon, impulse, explosive) {
    this.alive = false;
    const imp = _b.copy(dir).multiplyScalar(impulse);
    imp.y += explosive ? impulse * 0.7 : impulse * 0.12;
    const segKey = part === 'head' ? 'head' : part === 'leg' ? (Math.random() < 0.5 ? 'thighR' : 'thighL') : part === 'arm' ? (Math.random() < 0.5 ? 'uArmR' : 'uArmL') : 'torso';
    this.mflash.visible = false;
    if (this.ch.glint) this.ch.glint.scale.set(0.001, 0.001, 1);
    const dist = this.pos.distanceTo(player.pos);
    // taken down with the knife, he gets out a few last words
    if (weapon === 'knife') lastWords(this.name);
    this.ch.root.position.y = this.pos.y + this.hopY;
    makeRagdoll(this.ch, imp, segKey, point);
    this.cleanup();
    if (enemies.length > 1) callout('down', 0.3, this.pos);
    onEnemyKilled(this, { headshot: part === 'head' && !explosive, weapon, dist, explosive });
  }
  cleanup() {
    scene.remove(this.root);
    world.removeBody(this.body);
    scene.remove(this.laser);
    scene.remove(this.dot);
    const i = enemies.indexOf(this);
    if (i >= 0) enemies.splice(i, 1);
  }
  dispose() { if (this.alive) { this.alive = false; this.cleanup(); } }
}

export function spawnEnemy(kind, role, pos, opts) {
  const e = new Enemy(kind, role, pos, opts);
  enemies.push(e);
  return e;
}

/** Squad bookkeeping once per frame, then every raider thinks and moves. */
function updateSquad(dt) {
  pathCount = 0; coverCount = 0;
  squad.t += dt; squad.guessT -= dt; squad.nadeT -= dt;
  if (squad.pending) {
    squad.pendingT -= dt;
    if (squad.pendingT <= 0) { squad.pos.copy(squad.pending); squad.t = 0; squad.pending = null; }
  }
  // a player who holds one spot for long gets grenades
  if (player.pos.distanceTo(squad.campPos) < 3.5) squad.camp += dt;
  else { squad.campPos.copy(player.pos); squad.camp = 0; }
  let fx = 0, fz = 0, n = 0, fl = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.state === 'flank') fl++;
    if (e.canSee && e.target === player) { const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) || 1; fx += (e.pos.x - player.pos.x) / d; fz += (e.pos.z - player.pos.z) / d; n++; }
  }
  squad.flankers = fl;
  if (n) squad.front.set(fx, 0, fz).normalize();
}
export function updateEnemies(dt) {
  updateSquad(dt);
  for (const e of enemies.slice()) e.update(dt);
}
export function clearEnemies() { for (const e of enemies.slice()) e.dispose(); enemies.length = 0; resetSquad(); }
