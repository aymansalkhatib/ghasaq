import * as THREE from 'three';
import { clamp, damp, rand, randi, wrapAngle, pick } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { world, makeActorBody, driveActor } from '../core/physics.js';
import { enemies, allies, run, grenades, game } from '../core/state.js';
import { ALLY } from '../config/balance.js';
import { slideCircle, supportHeight, surfaceAt } from '../world/collision.js';
import { findPath } from '../world/nav.js';
import { zoneAt } from '../world/zones.js';
import { fx } from '../fx/particles.js';
import { bloodDecal } from '../fx/decals.js';
import { tracer, flashLight } from '../fx/tracers.js';
import { sfx } from '../audio/sfx.js';
import { radio } from '../audio/radio.js';
import { buildSoldier, animateSoldier } from './soldier-model.js';
import { makeRagdoll } from './ragdoll.js';
import { raycaster, losBlocked, hitNormal, bulletTargets } from './combat.js';
import { player } from './player.js';
import { findCover, noise } from './enemy.js';
import { unlockMedal } from '../systems/progression.js';
import { challengeEvent } from '../systems/challenges.js';

/*
 * A friendly soldier who arrives by parachute and fights like a squad mate: he keeps a slot a few
 * metres off the player's shoulder, crouches when you crouch, and when raiders show up he takes
 * cover near you, peeks, fires controlled bursts and ducks back to reload. He calls out contacts
 * by place name, heavies and snipers, reloads and incoming grenades. He wears the Syrian flag.
 * Raiders can shoot him, and so can a careless player (friendly fire hurts at a third of full damage).
 */

const LINES = {
  land: ['وصلت. أنا خلفك، تقدّم.', 'على الأرض. أغطي ظهرك.', 'جاهز للقتال، أين تريدني؟'],
  contact: ['غازٍ عند {z}!', 'هدف في {z}!', 'اشتباك! عدو عند {z}.', 'عدو على جناحنا، عند {z}!'],
  heavy: ['مدرّع قادم من {z}، صوّب على رأسه!', 'انتبه، مدرّع عند {z}!'],
  sniper: ['قنّاص على {z}! ابقَ خلف الساتر.', 'وميض منظار عند {z}!'],
  kill: ['أسقطته.', 'تمّ القضاء عليه.', 'هدف واحد أقل.', 'نظيف.'],
  reload: ['أبدّل المخزن، غطّني!', 'أعيد التذخير!'],
  nade: ['قنبلة! ابتعد!', 'قنبلة قريبة، تحرّك!'],
  hurt: ['أُصبت! ما زلت أقاتل.', 'أنا تحت النار!', 'أحتاج غطاءً!'],
  friendly: ['انتبه! أنت تطلق عليّ!', 'أوقف النار، أنا صديق!', 'ماذا تفعل؟! أنا في صفّك!'],
};
const MAG = 30;

/*
 * Talk between squad mates, written on the radio (never spoken): a suggestion to push when the
 * raiders thin out, telling you to fall back when you are bleeding, a wounded man saying so,
 * praise after a good run of kills, nerves in a lull, a word between the hours. With two men on
 * the ground, the second one answers the first.
 */
const BANTER = {
  push: [['ما رأيك بالتقدم؟ لم يبقَ منهم إلا القليل.', 'موافق، أغطيك من الجناح.'], ['الطريق يبدو خالياً، لنتقدم؟', 'بهدوء… خطوة خطوة.']],
  fallback: [['تراجع قليلاً، أنت تنزف!', 'سأغطيك، اذهب خلف الساتر!'], ['انسحب إلى الساتر، إصابتك سيئة!', 'أنا معك، تراجع وأنا أغطيك!']],
  bleeding: [['لقد نزفت كثيراً… لكنني باقٍ معك.', 'اضغط على الجرح، سننهي هذا معاً.'], ['جرحي يؤلمني… ما زلت أستطيع الرمي.', 'ابقَ خلفي، سأتقدم أنا.']],
  praise: [['أحسنت! ضربة معلّم.', 'هكذا نقاتل يا رجال!'], ['رائع! لم يرَ ما أصابه.', 'واحد آخر يسقط، استمر!']],
  lull: [['هدوء غريب… ابقَ متيقظاً.', 'أسمع حركة خلف السور.'], ['أين ذهبوا؟ هذا الصمت لا يعجبني.', 'إنهم يعيدون تجميع صفوفهم.']],
  between: [['ساعة أخرى صمدنا فيها. عبّئ سلاحك.', 'الليل ما زال طويلاً يا صديقي.'], ['هل تسمع الجرس؟ اقترب منتصف الليل.', 'لن نتركهم يأخذون هذا المكان.'], ['اشرب قليلاً من الماء، الموجة القادمة أصعب.', 'وأنا سأتفقد الذخيرة.']],
};
const TALK_GAP = { push: 60, fallback: 40, bleeding: 45, praise: 30, lull: 60, between: 20 };
const talkNext = {};
let talkAt = 0;
/** One exchange between squad mates. Returns true if someone spoke. */
export function squadTalk(kind, force = false) {
  const live = allies.filter((a) => a.alive && a.landed);
  if (!live.length || !BANTER[kind]) return false;
  const t = performance.now() / 1000;
  if (!force && (t < talkAt || t < (talkNext[kind] || 0))) return false;
  talkAt = t + 22;
  talkNext[kind] = t + TALK_GAP[kind];
  const [line, reply] = pick(BANTER[kind]);
  const a = kind === 'bleeding' ? (live.find((x) => x.hp < ALLY.hp * 0.45) || live[0]) : pick(live);
  radio(line, 'ally', false, a.name);
  const b = live.find((x) => x !== a);
  if (b && reply) radio(reply, 'ally', false, b.name);
  return true;
}

export class Ally {
  constructor(pos, name) {
    this.name = name;
    this.short = name.split(' ').pop();
    this.ch = buildSoldier('ally', randi(1e6));
    this.ch.ally = this;
    this.root = this.ch.root;
    scene.add(this.root);
    this.pos = pos.clone();
    this.vel = this.ch.vel;
    this.eyeH = 1.6; this.crouch = false; this.speed2d = 0;
    this.hp = ALLY.hp; this.alive = true; this.landed = false;
    this.yaw = 0; this.pitch = 0; this.flinch = 0; this.kick = 0;
    this.target = null; this.scanT = 0; this.fireT = 0.5; this.burst = 0; this.seeT = 0;
    this.path = null; this.pathI = 0; this.repathT = 0; this.lastHurt = 0; this.talkT = 0; this.stepD = 0;
    this.side = allies.length % 2 ? -1 : 1;   // two allies fan out left and right of the player
    this.mag = MAG; this.reloadT = 0;
    this.cover = null; this.peekPos = null; this.coverState = ''; this.coverT = 0; this.coverCD = 0;
    this.lastThreat = null; this.sprinting = false;
    this.body = makeActorBody();
    this.kills = 0;
    allies.push(this);
  }
  say(kind, force = false, at = null) {
    if (!force && this.talkT > 0) return;
    this.talkT = 5;
    let t = pick(LINES[kind]);
    if (at) t = t.replace('{z}', zoneAt(at.x, at.z));
    radio(t, 'ally', false, this.name);
  }
  land() { this.landed = true; this.say('land', true); }
  hurt(dmg) {
    if (!this.alive || !this.landed) return;
    this.hp -= dmg;
    this.flinch = 1;
    this.lastHurt = 0;
    if (this.hp <= 0) this.die();
    else if (Math.random() < 0.3) this.say('hurt');
  }
  /** Hit by the player's own fire. */
  friendlyHit(dmg, point, dir) {
    fx.blood(point, dir, 0.8);
    raycaster.set(point, dir); raycaster.near = 0; raycaster.far = 3;
    const h = raycaster.intersectObjects(bulletTargets.world(), false)[0];
    if (h) bloodDecal(h.point, hitNormal(h), rand(0.4, 0.8));
    this.hurt(dmg / 3);
    if (this.alive) this.say('friendly', this.talkT < 4);
  }
  die() {
    this.alive = false;
    makeRagdoll(this.ch, new THREE.Vector3(rand(-20, 20), 10, rand(-20, 20)), 'torso', this.pos.clone().setY(1.2));
    this.cleanup();
    radio(`فقدنا ${this.name}. أعد التمركز!`, 'hq', true);
  }
  cleanup() {
    scene.remove(this.root);
    world.removeBody(this.body);
    const i = allies.indexOf(this);
    if (i >= 0) allies.splice(i, 1);
  }
  dispose() { if (this.alive) { this.alive = false; this.cleanup(); } }
  creditKill() {
    this.kills++;
    run.allyKills++;
    if (run.allyKills >= 5) unlockMedal('buddy');
    challengeEvent('allyKill');
    if (Math.random() < 0.5) this.say('kill');
  }

  /** Walk toward `goal` (paths round walls when it is far). Returns true on arrival. */
  moveTo(goal, speed, desired, dt) {
    const dx0 = goal.x - this.pos.x, dz0 = goal.z - this.pos.z, d0 = Math.hypot(dx0, dz0);
    if (d0 < 0.7) return true;
    if (d0 < 5) { desired.set((dx0 / d0) * speed, 0, (dz0 / d0) * speed); return false; }
    this.repathT -= dt;
    if (!this.path || this.repathT <= 0) { this.repathT = 1.2; this.path = findPath(this.pos.x, this.pos.z, goal.x, goal.z); this.pathI = 1; }
    if (this.path && this.pathI < this.path.length) {
      const wp = this.path[this.pathI], dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.7) this.pathI++; else desired.set((dx / d) * speed, 0, (dz / d) * speed);
    } else desired.set((dx0 / d0) * speed, 0, (dz0 / d0) * speed);
    return false;
  }

  /** The first man of the squad decides when it is time for a word (once a second). */
  banter(dt) {
    this.banterT = (this.banterT ?? 4) - dt;
    if (this.banterT > 0) return;
    this.banterT = 1;
    if (game.state !== 'playing' || game.inter > 0) return;
    if (player.alive && player.hp < 40) { squadTalk('fallback'); return; }
    if (allies.some((a) => a.alive && a.landed && a.hp < ALLY.hp * 0.45)) { squadTalk('bleeding'); return; }
    const alive = enemies.filter((e) => e.alive).length;
    const contact = enemies.some((e) => e.alive && (e.canSee || e.pos.distanceTo(player.pos) < 22));
    this.quietT = contact ? 0 : (this.quietT || 0) + 1;
    if (alive > 0 && alive <= 2 && game.toSpawn === 0 && !contact && player.hp > 50) { squadTalk('push'); return; }
    if (this.quietT > 12 && alive > 0) squadTalk('lull');
  }

  update(dt) {
    if (!this.alive || !this.landed) return;
    if (allies[0] === this) this.banter(dt);
    this.talkT -= dt;
    this.lastHurt += dt;
    this.coverCD -= dt;
    if (this.lastHurt > 5) this.hp = Math.min(ALLY.hp, this.hp + ALLY.regen * dt);
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = MAG; }
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.05 : 1.55), this.pos.z);

    // who can he see? the nearest raider in the open (heavies and snipers get called out by name)
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.25;
      let best = null, bestD = 60;
      for (const e of enemies) {
        if (!e.alive || e.rope) continue;
        const d = e.pos.distanceTo(this.pos) * (e.static ? 0.8 : 1);
        if (d > bestD) continue;
        if (losBlocked(eye, new THREE.Vector3(e.pos.x, e.pos.y + 1.3, e.pos.z))) continue;
        best = e; bestD = d;
      }
      if (best && best !== this.target) {
        this.seeT = 0;
        if (Math.random() < 0.6) this.say(best.static ? 'sniper' : best.kind === 'heavy' ? 'heavy' : 'contact', false, best.pos);
      }
      this.target = best;
      if (best) this.lastThreat = best.pos.clone();
    }
    for (const g of grenades) if (g.hostile && g.m.position.distanceTo(this.pos) < 7 && g.fuse < 2.2) { this.say('nade', true); this.cover = null; break; }

    // his slot: a few metres behind and off to one side of the player
    const fx0 = -Math.sin(player.yaw), fz0 = -Math.cos(player.yaw);
    const slot = new THREE.Vector3(player.pos.x - fx0 * 3 + fz0 * 3.2 * this.side, 0, player.pos.z - fz0 * 3 - fx0 * 3.2 * this.side);
    const pd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const desired = new THREE.Vector3();
    const T = this.target;
    this.sprinting = false;
    this.crouch = false;
    if (pd > 14) {
      // fallen behind: run to catch up, fighting can wait
      this.cover = null;
      this.sprinting = true;
      this.moveTo(player.pos, 5.6, desired, dt);
    } else if (T && T.alive) {
      this.seeT += dt;
      if (!this.cover && this.coverCD <= 0) {
        this.coverCD = 3;
        const c = findCover(this, T.pos, 'fight', allies, slot);
        if (c) { this.cover = c.pos; this.peekPos = c.peek; this.coverState = 'move'; this.coverT = 6; this.path = null; }
      }
      if (this.cover) {
        this.coverT -= dt;
        if (this.coverState === 'move') {
          this.sprinting = true;
          if (this.moveTo(this.cover, 5.2, desired, dt)) { this.coverState = 'peek'; this.coverT = rand(1.6, 2.8); }
          else if (this.coverT <= 0) this.cover = null;
        } else {
          const spot = this.coverState === 'peek' ? this.peekPos : this.cover;
          this.moveTo(spot, 2.2, desired, dt);
          this.crouch = this.coverState === 'hide';
          if (this.coverState === 'hide' && this.mag < MAG * 0.6 && this.reloadT <= 0) this.startReload();
          if (this.coverT <= 0) {
            if (this.coverState === 'peek') { this.coverState = 'hide'; this.coverT = rand(0.8, 1.5); }
            else if (this.reloadT <= 0) { this.coverState = 'peek'; this.coverT = rand(1.6, 2.8); }
          }
          if (pd > 11 || this.cover.distanceTo(T.pos) < 5) this.cover = null;
        }
      } else if (Math.hypot(slot.x - this.pos.x, slot.z - this.pos.z) > 1.5) this.moveTo(slot, 2.4, desired, dt);
      else this.crouch = T.pos.distanceTo(this.pos) > 12;   // no cover to hand: take a knee and shoot
    } else {
      this.cover = null;
      // follow: walk with the player, jog when he runs, crouch when he crouches
      const far = Math.hypot(slot.x - this.pos.x, slot.z - this.pos.z);
      if (far > 1.2) this.moveTo(slot, clamp(far * 1.3, 1.2, player.sprinting || far > 6 ? 5.4 : 4.4), desired, dt);
      this.sprinting = far > 6;
      this.crouch = player.crouch;
    }
    if (this.crouch) desired.multiplyScalar(0.55);
    for (const a of allies) {
      if (a === this || !a.alive) continue;
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 3 && d2 > 1e-4) { const d = Math.sqrt(d2); desired.x += (dx / d) * 1.5; desired.z += (dz / d) * 1.5; }
    }
    const dxp = this.pos.x - player.pos.x, dzp = this.pos.z - player.pos.z, dp2 = dxp * dxp + dzp * dzp;
    if (dp2 < 2.2 && dp2 > 1e-4) { const d = Math.sqrt(dp2); desired.x += (dxp / d) * 2; desired.z += (dzp / d) * 2; }
    this.vel.x += (desired.x - this.vel.x) * damp(6, dt);
    this.vel.z += (desired.z - this.vel.z) * damp(6, dt);
    slideCircle(this.pos, this.vel.x * dt, this.vel.z * dt, 0.38, 1.75);
    this.pos.y += (supportHeight(this.pos.x, this.pos.z, this.pos.y + 0.45, 0.2) - this.pos.y) * damp(12, dt);
    this.speed2d = Math.hypot(this.vel.x, this.vel.z);
    this.stepD += this.speed2d * dt;
    if (this.stepD > (this.speed2d > 3.4 ? 1.55 : 1.9)) { this.stepD = 0; if (this.pos.distanceTo(player.pos) < 22) sfx.stepAt(this.pos, surfaceAt(this.pos.x, this.pos.z, this.pos.y), this.crouch ? 0.15 : 0.3); }

    // looks: at the target, else where the last threat was, else the way the player looks
    let faceYaw = this.speed2d > 0.6 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw, tp = 0;
    if (T && T.alive) {
      const tx = T.pos.x - this.pos.x, ty = T.pos.y + 1.2 - eye.y, tz = T.pos.z - this.pos.z;
      faceYaw = Math.atan2(tx, tz);
      tp = Math.atan2(ty + 0.35, Math.hypot(tx, tz));
      const hiding = this.cover && this.coverState !== 'peek';
      this.fireT -= dt;
      if (!hiding && this.reloadT <= 0 && this.seeT > 0.45 && this.fireT <= 0 && Math.abs(wrapAngle(faceYaw - this.yaw)) < 0.3) {
        if (this.burst <= 0) this.burst = randi(ALLY.burst[1] - ALLY.burst[0] + 1) + ALLY.burst[0];
        this.fire(T);
        this.burst--;
        this.fireT = this.burst > 0 ? ALLY.rof : rand(0.7, 1.3);
      }
    } else if (this.speed2d < 0.6) faceYaw = this.lastThreat && this.lastThreat.distanceTo(this.pos) < 40 ? Math.atan2(this.lastThreat.x - this.pos.x, this.lastThreat.z - this.pos.z) : player.yaw + Math.PI + this.side * 0.6;
    this.yaw += wrapAngle(faceYaw - this.yaw) * damp(8, dt);
    this.pitch += (tp - this.pitch) * damp(6, dt);
    this.flinch *= Math.exp(-8 * dt);
    this.kick *= Math.exp(-14 * dt);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    animateSoldier(this.ch, dt, { vel: this.vel, yaw: this.yaw, pitch: this.pitch, flinch: this.flinch, kick: this.kick, crouch: this.crouch, sprint: this.sprinting && !T, ready: T || this.lastThreat ? 1 : 0.4 });
    driveActor(this.body, this.pos, this.vel);
  }
  startReload() {
    this.reloadT = 2.3;
    this.burst = 0;
    sfx.reloadAt(this.pos.clone().setY(this.pos.y + 1.2));
    if (Math.random() < 0.5) this.say('reload');
  }
  fire(T) {
    if (--this.mag <= 0) this.startReload();
    const mz = this.ch.muzzle.getWorldPosition(new THREE.Vector3());
    const aim = new THREE.Vector3(T.pos.x, T.pos.y + 1.2, T.pos.z);
    const dist = mz.distanceTo(aim), sp = ALLY.spread * (1 + dist / 30) * (this.crouch ? 0.8 : 1);
    const dir = aim.sub(mz).normalize();
    dir.x += rand(-1, 1) * sp; dir.y += rand(-1, 1) * sp * 0.6; dir.z += rand(-1, 1) * sp;
    dir.normalize();
    raycaster.set(mz, dir); raycaster.near = 0; raycaster.far = 120;
    const h = raycaster.intersectObjects(bulletTargets.hostiles(), false)[0];
    let end = mz.clone().addScaledVector(dir, 120);
    if (h) {
      end = h.point;
      const e = h.object.userData.ch && h.object.userData.ch.enemy;
      if (e && e.alive) {
        if (e.takeDamage(ALLY.dmg, h.object.userData.part, h.point.clone(), dir.clone(), 'ally', 50)) this.creditKill();
      } else fx.impact(h.point, new THREE.Vector3(0, 1, 0), h.object.userData.surface || 'stone');
    }
    tracer(mz, end, 'ally');
    flashLight(mz, 35, 8, 0.06);
    sfx.shot('ally', mz);
    fx.muzzleSmoke(mz, dir);
    noise(this.pos, 40, 'shot', false);
    this.kick = 1;
  }
}
