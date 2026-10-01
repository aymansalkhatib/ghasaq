import * as THREE from 'three';
import { damp, rand } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { parachutes } from '../core/state.js';
import { supportHeight } from '../world/collision.js';
import { fx } from '../fx/particles.js';
import { sfx } from '../audio/sfx.js';
import { buildParachute } from './models.js';

/*
 * Guided parachute (like a GPS-steered cargo chute). After a short free fall the canopy opens
 * and the payload steers itself onto `target`, so a drop always lands exactly where it was
 * called — inside the walls, never on a roof. kind: 'cargo' (orange, faster) or 'trooper'.
 */

const _d = new THREE.Vector3();

export function dropWithChute(pos, payload) {
  const chute = buildParachute(payload.kind);
  chute.g.scale.setScalar(0.01);
  scene.add(chute.g);
  parachutes.push({
    ...payload, chute, pos: pos.clone(), vel: payload.vel ? payload.vel.clone() : new THREE.Vector3(),
    t: 0, state: 'fall', collapse: 0, phase: rand(0, 6), sink: payload.kind === 'cargo' ? 8.5 : 5.5,
  });
}

export function updateParachutes(dt) {
  for (let i = parachutes.length - 1; i >= 0; i--) {
    const p = parachutes[i];
    p.t += dt;
    if (p.state === 'fall' || p.state === 'open') {
      if (p.state === 'fall' && p.t > 0.6) { p.state = 'open'; sfx.chute(p.pos); }
      const open = p.state === 'open';
      if (open) {
        p.vel.y += (-p.sink - p.vel.y) * damp(2.5, dt);
        if (p.target) {
          // steer toward the landing point; lock on hard for the last metres
          _d.set(p.target.x - p.pos.x, 0, p.target.z - p.pos.z);
          const height = p.pos.y - supportHeight(p.target.x, p.target.z, p.pos.y);
          const k = height < 10 ? 3 : 0.9;
          _d.multiplyScalar(k);
          if (_d.length() > 10) _d.setLength(10);
          p.vel.x += (_d.x - p.vel.x) * damp(2, dt);
          p.vel.z += (_d.z - p.vel.z) * damp(2, dt);
        } else { p.vel.x *= Math.exp(-1.4 * dt); p.vel.z *= Math.exp(-1.4 * dt); }
      } else {
        p.vel.y -= 9.8 * dt;
        p.vel.x *= Math.exp(-0.4 * dt); p.vel.z *= Math.exp(-0.4 * dt);
      }
      p.pos.addScaledVector(p.vel, dt);
      const s = open ? Math.min(1, (p.t - 0.6) / 0.6) : 0.01;
      p.chute.g.scale.set(s, s, s);
      const sway = open ? Math.sin(p.t * 1.3 + p.phase) * 0.1 : 0;
      p.chute.g.position.copy(p.pos).setY(p.pos.y + 0.2);
      p.chute.g.rotation.set(sway, p.t * 0.15, Math.cos(p.t * 1.1 + p.phase) * 0.08);
      if (p.obj) { p.obj.position.copy(p.pos); p.obj.rotation.z = sway * 0.6; }
      if (p.onFly) p.onFly(p, dt);
      const ground = supportHeight(p.pos.x, p.pos.z, p.pos.y + 0.1, 0.4);
      if (p.pos.y <= ground) {
        if (p.target) { p.pos.x = p.target.x; p.pos.z = p.target.z; }
        p.pos.y = supportHeight(p.pos.x, p.pos.z, p.pos.y + 0.2, 0.4);
        p.state = 'landed';
        if (p.obj) { p.obj.position.copy(p.pos); p.obj.rotation.z = 0; }
        fx.burstDust(p.pos.x, p.pos.y + 0.2, p.pos.z, 0.72, 0.6, 0.42, p.kind === 'cargo' ? 30 : 14, 3);
        if (p.onLand) p.onLand(p.pos.clone());
      }
    } else {
      // the canopy collapses and drifts downwind, then disappears
      p.collapse += dt / 1.8;
      const c = Math.min(1, p.collapse);
      p.chute.g.scale.set(1 + c * 0.2, Math.max(0.04, 1 - c), 1 + c * 0.2);
      p.chute.g.position.x += dt * 1.4;
      p.chute.g.position.y = Math.max(0.1, p.chute.g.position.y - dt * 2);
      p.chute.g.rotation.z = c * 0.9;
      if (p.collapse > 4) { scene.remove(p.chute.g); parachutes.splice(i, 1); }
    }
  }
}
export function clearParachutes() {
  for (const p of parachutes) scene.remove(p.chute.g);
  parachutes.length = 0;
}
