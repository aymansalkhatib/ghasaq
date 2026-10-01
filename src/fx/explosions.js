import * as THREE from 'three';
import { CANNON } from '../core/physics.js';
import { clamp, rand, UP } from '../core/utils.js';
import { camera, grade } from '../core/renderer.js';
import { enemies, props, debris, allies } from '../core/state.js';
import { supportHeight } from '../world/collision.js';
import { breakCrate } from '../world/props.js';
import { scatterBirds } from '../world/ambient.js';
import { explodeRagdolls } from '../entities/ragdoll.js';
import { losBlocked } from '../entities/combat.js';
import { player } from '../entities/player.js';
import { noise } from '../entities/enemy.js';
import { unlockMedal } from '../systems/progression.js';
import { fx } from './particles.js';
import { decal, DMAT } from './decals.js';
import { flashLight } from './tracers.js';
import { sfx } from '../audio/sfx.js';

/* Grenades, red barrels, air-strike bombs and helicopter crashes all go through explode(). */

const _v = new THREE.Vector3();
const SOURCE_NAME = { nade: 'قنبلتك', enemyNade: 'قنبلة معادية', barrel: 'برميل متفجر', airstrike: 'الغارة الجوية', heli: 'حطام المروحية' };

/** Returns how many raiders the blast killed. */
export function explode(pos, radius, dmg, source, big = false) {
  fx.explosion(pos, big);
  flashLight(_v.copy(pos).setY(pos.y + 1), big ? 1600 : 900, big ? 45 : 30, 0.5, 0xff9a4a);
  const gy = supportHeight(pos.x, pos.z, pos.y + 0.3);
  if (pos.y - gy < 1.5) decal(new THREE.Vector3(pos.x, gy, pos.z), UP, DMAT.scorch, rand(3.2, 4.2) * (big ? 1.5 : 1));
  sfx.explosion(pos, big);
  scatterBirds();
  noise(pos, 60, 'shot', false);

  const pd = camera.position.distanceTo(pos);
  player.shake = Math.max(player.shake, clamp((big ? 2.2 : 1.6) - pd / 18, 0, 2));
  if (pd < 16) {
    grade.uniforms.uFlash.value = Math.max(grade.uniforms.uFlash.value, clamp(0.5 - pd / 32, 0, 0.5));
    sfx.deafen(clamp(1 - pd / 16, 0, 1));
  }

  let kills = 0;
  const from = pos.clone().setY(pos.y + 0.4);
  for (const e of enemies.slice()) {
    if (!e.alive) continue;
    const ep = new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z);
    const d = ep.distanceTo(pos);
    if (d > radius || losBlocked(from, ep)) continue;
    const k = 1 - d / radius;
    const dir = new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z).normalize();
    if (e.takeDamage(dmg * k, 'torso', ep, dir, source, 240 * k + 60, true)) kills++;
  }
  const pp = new THREE.Vector3(player.pos.x, player.pos.y + 1, player.pos.z);
  const pdist = pp.distanceTo(pos);
  if (player.alive && pdist < radius && !losBlocked(from, pp)) player.hurt(dmg * 0.75 * (1 - pdist / radius), pos, true, SOURCE_NAME[source] || 'انفجار');
  for (const ally of allies.slice()) {
    if (!ally.alive || !ally.landed) continue;
    const ap = new THREE.Vector3(ally.pos.x, ally.pos.y + 1, ally.pos.z), ad = ap.distanceTo(pos);
    if (ad < radius && !losBlocked(from, ap)) ally.hurt(dmg * 0.8 * (1 - ad / radius), pos);
  }
  explodeRagdolls(pos, radius, 14);
  for (const p of props.slice()) {
    const b = p.body, d = _v.set(b.position.x - pos.x, b.position.y - pos.y + 0.3, b.position.z - pos.z);
    const dist = d.length();
    if (dist > radius) continue;
    const k = 1 - dist / radius;
    if (p.kind === 'xbarrel' && p.fuse < 0) { p.fuse = 0.12 + dist * 0.04; continue; }
    if (p.kind === 'crate' && k > 0.45) { breakCrate(p, d.clone().normalize()); continue; }
    b.wakeUp();
    d.normalize().multiplyScalar(k * b.mass * 12);
    b.applyImpulse(new CANNON.Vec3(d.x, d.y + k * b.mass * 5, d.z));
  }
  for (const db of debris) {
    const b = db.body, v = _v.set(b.position.x - pos.x, b.position.y - pos.y + 0.3, b.position.z - pos.z), dist = v.length();
    if (dist > radius) continue;
    b.wakeUp();
    v.normalize().multiplyScalar((1 - dist / radius) * b.mass * 10);
    b.applyImpulse(new CANNON.Vec3(v.x, v.y + 3 * b.mass, v.z));
  }
  if (kills >= 3) unlockMedal('tri');
  return kills;
}
