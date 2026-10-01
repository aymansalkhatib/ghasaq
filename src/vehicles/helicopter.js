import * as THREE from 'three';
import { TAU, clamp, damp, rand, pick } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { refs, run } from '../core/state.js';
import { SCORE } from '../config/balance.js';
import { HOVER_POINTS } from '../world/map.js';
import { supportHeight } from '../world/collision.js';
import { makeLoop } from '../audio/engine.js';
import { sfx } from '../audio/sfx.js';
import { radio } from '../audio/radio.js';
import { fx } from '../fx/particles.js';
import { tracer, flashLight } from '../fx/tracers.js';
import { explode } from '../fx/explosions.js';
import { MAT } from '../assets/materials.js';
import { raycaster, losBlocked, rayCharacter, bulletTargets } from '../entities/combat.js';
import { player } from '../entities/player.js';
import { spawnEnemy, waveCfg } from '../entities/enemy.js';
import { award, unlockMedal } from '../systems/progression.js';
import { challengeEvent } from '../systems/challenges.js';
import { buildHeli } from './models.js';

/*
 * Enemy transport helicopter: flies in, hovers, fast-ropes a squad down, then leaves.
 * A door gunner fires short bursts while it hovers. 1800 HP; shot down it spins, trails smoke,
 * crashes and explodes — killing any raiders still on the ropes.
 */

const ROPE_GEO = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, -0.5, 0);
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export class Helicopter {
  constructor(troops, makeTroop) {
    this.m = buildHeli();
    this.g = this.m.g;
    this.hitbox = this.m.hitbox;
    this.hitbox.userData.heli = this;
    scene.add(this.g);
    this.maxHp = 1800; this.hp = this.maxHp;
    this.hover = pick(HOVER_POINTS).clone();
    const a = rand(0, TAU);
    this.pos = this.hover.clone().add(_v.set(Math.cos(a) * 320, 30, Math.sin(a) * 320));
    this.vel = new THREE.Vector3();
    this.yaw = Math.atan2(this.hover.x - this.pos.x, this.hover.z - this.pos.z);
    this.state = 'approach'; this.t = 0; this.stateT = 0;
    this.troops = troops; this.makeTroop = makeTroop; this.roping = [];
    this.gunT = 3; this.burst = 0; this.spin = 0;
    this.ropes = [];
    this.snd = makeLoop('heli', 2.2);
    refs.heli = this;
    radio('رصدنا مروحية معادية تقترب. استعد للإنزال!', 'hq', true);
  }
  hit(dmg, point) {
    if (this.state === 'crash' || this.state === 'dead') return;
    this.hp -= dmg;
    sfx.heliHit(point);
    if (this.hp <= 0) this.shootDown();
  }
  shootDown() {
    this.state = 'crash';
    this.vel.set(this.vel.x * 0.5, -2, this.vel.z * 0.5);
    for (const r of this.ropes) this.g.remove(r);
    for (const e of this.roping) if (e.alive && e.rope) e.takeDamage(999, 'torso', e.pos.clone().setY(e.pos.y + 1), new THREE.Vector3(0, -1, 0), 'heli', 40, true);
    run.heliDowns++;
    award('إسقاط مروحية', SCORE.heli);
    unlockMedal('heli');
    challengeEvent('heli');
    radio('أصبت المروحية! إنها تسقط!', 'hq', true);
  }
  deployRopes() {
    for (const s of [-1, 1]) {
      const rope = new THREE.Mesh(ROPE_GEO, MAT.darkMetal);
      rope.position.set(s * 1.5, -0.6, 0.4);
      this.g.add(rope);
      this.ropes.push(rope);
    }
  }
  update(dt) {
    this.t += dt; this.stateT += dt;
    const m = this.m;
    m.rotor.rotation.y += dt * (this.state === 'dead' ? 0 : 24);
    m.tailRotor.rotation.x += dt * (this.state === 'dead' ? 0 : 40);
    m.blur.visible = this.state !== 'dead';
    m.lights[0].visible = (this.t * 1.3) % 1 < 0.15 && this.state !== 'dead';
    if (this.state === 'approach') {
      _d.subVectors(this.hover, this.pos);
      const dist = _d.length();
      const want = _d.normalize().multiplyScalar(Math.min(34, dist * 0.6 + 2));
      this.vel.lerp(want, damp(1.2, dt));
      if (dist < 1.5 && this.vel.length() < 1.5) { this.state = 'hover'; this.stateT = 0; this.deployRopes(); }
    } else if (this.state === 'hover') {
      this.vel.multiplyScalar(Math.exp(-3 * dt));
      this.pos.y = this.hover.y + Math.sin(this.t * 1.3) * 0.25;
      if (this.troops > 0 && this.stateT > 0.8 + (4 - this.troops) * 0.7) {
        const side = this.troops % 2 ? 1 : -1;
        const p = this.g.localToWorld(_v.set(side * 1.5, -0.8, 0.4));
        const e = this.makeTroop(p, { y0: p.y, onLand: () => { const i = this.roping.indexOf(e); if (i >= 0) this.roping.splice(i, 1); } });
        this.roping.push(e);
        this.troops--;
      }
      for (const r of this.ropes) r.scale.y = Math.min(this.hover.y + 0.3, r.scale.y + dt * 30);
      this.doorGun(dt);
      if (this.troops <= 0 && this.roping.length === 0 && this.stateT > 6) { this.state = 'depart'; this.stateT = 0; for (const r of this.ropes) this.g.remove(r); }
    } else if (this.state === 'depart') {
      this.vel.lerp(_v.set(Math.sin(this.yaw) * 40, 14, Math.cos(this.yaw) * 40), damp(0.8, dt));
      if (this.stateT > 12) { this.remove(); return false; }
    } else if (this.state === 'crash') {
      this.vel.y -= 9.8 * dt;
      this.spin = Math.min(6, this.spin + dt * 3);
      this.yaw += this.spin * dt;
      fx.smoke(this.pos.x, this.pos.y + 1, this.pos.z, 0.1, 0.09, 0.08, 2, 1.6);
      fx.fire(this.pos.x, this.pos.y + 1.2, this.pos.z, 3);
      const ground = supportHeight(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y - 1.6 <= ground) {
        this.pos.y = ground + 1.6;
        this.state = 'dead'; this.stateT = 0;
        explode(this.pos.clone(), 11, 320, 'heli', true);
        this.g.rotation.z = 0.5;
        this.snd.stop(0.3);
      }
    } else if (this.state === 'dead') {
      if (this.stateT < 30) { if (Math.random() < 0.6) fx.fire(this.pos.x + rand(-1, 1), this.pos.y, this.pos.z + rand(-1, 1), 2); if (Math.random() < 0.3) fx.smoke(this.pos.x, this.pos.y + 1.5, this.pos.z, 0.12, 0.1, 0.09, 1, 1.4); }
      else if (this.stateT > 40) { this.remove(); return false; }
      this.snd.update(this.pos, null);
      return true;
    }
    this.pos.addScaledVector(this.vel, dt);
    if (this.state !== 'crash' && this.state !== 'dead') {
      const hv = Math.hypot(this.vel.x, this.vel.z);
      const y0 = this.yaw;
      if (hv > 1) this.yaw += Math.atan2(Math.sin(Math.atan2(this.vel.x, this.vel.z) - this.yaw), Math.cos(Math.atan2(this.vel.x, this.vel.z) - this.yaw)) * damp(1.5, dt);
      // nose down to speed up, flare nose-up to slow into the hover, roll into turns, a little wobble in the hover
      const accel = dt > 0 ? (hv - (this.hv0 ?? hv)) / dt : 0, yawRate = dt > 0 ? (this.yaw - y0) / dt : 0;
      this.hv0 = hv;
      this.tilt = (this.tilt || 0) + (clamp(hv * 0.011 + accel * 0.04, -0.22, 0.32) - (this.tilt || 0)) * damp(3, dt);
      this.roll = (this.roll || 0) + (clamp(-yawRate * 0.9, -0.4, 0.4) - (this.roll || 0)) * damp(3, dt);
      const wob = this.state === 'hover' ? 0.025 : 0.008;
      this.g.rotation.set(this.tilt + Math.sin(this.t * 1.1) * wob, this.yaw, this.roll + Math.sin(this.t * 0.8 + 1) * wob, 'YXZ');
    } else this.g.rotation.set(this.state === 'crash' ? 0.2 : 0, this.yaw, this.state === 'crash' ? 0.25 : 0.5, 'YXZ');
    this.g.position.copy(this.pos);
    if (this.hp < this.maxHp * 0.5 && this.state !== 'crash' && Math.random() < 0.5) fx.smoke(this.pos.x, this.pos.y + 1.5, this.pos.z, 0.14, 0.13, 0.12, 1, 1.2);
    this.snd.update(this.pos, this.vel);
    return true;
  }
  doorGun(dt) {
    if (!player.alive) return;
    this.gunT -= dt;
    if (this.gunT > 0) return;
    const tip = this.m.gunTip.getWorldPosition(new THREE.Vector3());
    const aim = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
    if (losBlocked(tip, aim)) { this.gunT = 0.6; return; }
    if (this.burst <= 0) this.burst = 5;
    const dir = aim.sub(tip).normalize();
    const sp = 0.055 * (1 + player.speed2d * 0.15);
    dir.x += rand(-1, 1) * sp; dir.y += rand(-1, 1) * sp; dir.z += rand(-1, 1) * sp;
    dir.normalize();
    raycaster.set(tip, dir); raycaster.near = 0; raycaster.far = 120;
    const h = raycaster.intersectObjects(bulletTargets.world(), false)[0];
    const pd = rayCharacter(tip, dir, player);
    let end = h ? h.point : tip.clone().addScaledVector(dir, 120);
    if (pd >= 0 && (!h || pd < h.distance)) { end = tip.clone().addScaledVector(dir, pd); player.hurt(5 * waveCfg.dmg, this.pos, false, 'رامي المروحية'); }
    else if (h) fx.impact(h.point, new THREE.Vector3(0, 1, 0), h.object.userData.surface || 'sand');
    tracer(tip, end, 'enemy');
    flashLight(tip, 40, 8, 0.06);
    sfx.shot('doorgun', tip);
    this.burst--;
    this.gunT = this.burst > 0 ? 0.1 : rand(1.8, 2.6);
  }
  remove() {
    this.snd.stop(0.5);
    scene.remove(this.g);
    if (refs.heli === this) refs.heli = null;
    this.state = 'dead';
  }
}

let heli = null;
export function spawnHelicopter(troops, kindPicker) {
  if (heli) return;
  heli = new Helicopter(troops, (pos, rope) => {
    const [kind, role] = kindPicker();
    return spawnEnemy(kind, role, pos, { rope });
  });
}
export function updateHelicopter(dt) {
  if (!heli) return;
  if (!heli.update(dt)) heli = null;
}
export function clearHelicopter() { if (heli) { heli.remove(); heli = null; } }
export const heliActive = () => !!heli && heli.state !== 'dead';
