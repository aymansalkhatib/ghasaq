import * as THREE from 'three';
import { TAU, rand } from '../core/utils.js';
import { scene, Q } from '../core/renderer.js';
import { settings } from '../config/settings.js';
import { TEX } from '../assets/textures.js';

/* Two GPU point pools (additive for fire and sparks, alpha for dust, smoke and blood) plus effect recipes. */

class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.head = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4); this.base = new Float32Array(max * 4);
    this.size = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.stick = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 }, uMap: { value: TEX.soft } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aSize; attribute vec4 aColor; uniform float uScale; varying vec4 vC;
        void main() {
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.05, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying vec4 vC;
        void main() { float a = texture2D(uMap, gl_PointCoord).a * vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb, a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }
  add(x, y, z, vx, vy, vz, r, g, b, a, s0, s1, life, grav = 0, drag = 1, stick = 0) {
    if (Q.particles < 1 && Math.random() > Q.particles) return;
    const i = this.head; this.head = (this.head + 1) % this.max;
    const j = i * 3, k = i * 4;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.base[k] = r; this.base[k + 1] = g; this.base[k + 2] = b; this.base[k + 3] = a;
    this.s0[i] = s0; this.s1[i] = s1; this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.stick[i] = stick;
  }
  clear() { this.life.fill(0); this.size.fill(0); }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]), j = i * 3, k = i * 4;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= dr; this.vel[j + 2] *= dr; this.vel[j + 1] = this.vel[j + 1] * dr - this.grav[i] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.stick[i] && this.pos[j + 1] < 0.02) { this.pos[j + 1] = 0.02; this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0; }
      this.col[k] = this.base[k]; this.col[k + 1] = this.base[k + 1]; this.col[k + 2] = this.base[k + 2];
      this.col[k + 3] = this.base[k + 3] * Math.min(1, t * 2.2);
      this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

let add = null, alpha = null;
export function initParticles() {
  add = new ParticlePool(1800, true);
  alpha = new ParticlePool(2600, false);
}

const SURF = {
  sand: [0.72, 0.58, 0.4], plaster: [0.8, 0.68, 0.52], stone: [0.7, 0.62, 0.5], wood: [0.5, 0.36, 0.22], metal: [0.5, 0.5, 0.5],
};
const _n = new THREE.Vector3();

export const fx = {
  update(dt) { add.update(dt); alpha.update(dt); },
  clear() { add.clear(); alpha.clear(); },
  setScale(v) { add.mat.uniforms.uScale.value = v; alpha.mat.uniforms.uScale.value = v; },
  burstDust(x, y, z, r, g, b, n, spd) {
    for (let k = 0; k < n; k++) alpha.add(x, y, z, rand(-1, 1) * spd, rand(0, 1) * spd, rand(-1, 1) * spd, r, g, b, 0.55, rand(0.2, 0.4), rand(0.9, 1.6), rand(0.8, 1.6), -0.3, 2.5);
  },
  impact(p, n, surface) {
    const c = SURF[surface] || SURF.stone;
    for (let k = 0; k < 5; k++) alpha.add(p.x, p.y, p.z, n.x * rand(0.5, 1.8) + rand(-0.4, 0.4), n.y * rand(0.5, 1.8) + rand(0, 0.6), n.z * rand(0.5, 1.8) + rand(-0.4, 0.4), c[0], c[1], c[2], 0.6, rand(0.08, 0.16), rand(0.4, 0.8), rand(0.5, 1.1), -0.2, 3);
    for (let k = 0; k < 6; k++) alpha.add(p.x, p.y, p.z, n.x * rand(2, 5) + rand(-2, 2), n.y * rand(2, 5) + rand(0, 3), n.z * rand(2, 5) + rand(-2, 2), c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1, 0.035, 0.03, rand(0.4, 0.8), 9.8, 0.5, 1);
    if (surface === 'metal' || surface === 'stone') this.sparks(p, n, surface === 'metal' ? 10 : 4);
  },
  sparks(p, n, count) {
    for (let k = 0; k < count; k++) add.add(p.x, p.y, p.z, n.x * rand(2, 6) + rand(-3, 3), n.y * rand(2, 6) + rand(0, 3), n.z * rand(2, 6) + rand(-3, 3), 3, 1.8, 0.7, 1, 0.05, 0.02, rand(0.15, 0.35), 9.8, 0.5);
  },
  blood(p, dir, amount = 1) {
    if (!settings.blood) { this.impact(p, _n.copy(dir).negate(), 'sand'); return; }
    const n = Math.round(22 * amount);
    for (let k = 0; k < n; k++) {
      const s = rand(1.5, 6);
      alpha.add(p.x, p.y, p.z, dir.x * s + rand(-1.5, 1.5), dir.y * s + rand(-0.5, 2), dir.z * s + rand(-1.5, 1.5), rand(0.35, 0.55), 0.02, 0.015, 1, rand(0.03, 0.07), 0.03, rand(0.5, 1.1), 9.8, 0.4, 1);
    }
    for (let k = 0; k < 8 * amount; k++) alpha.add(p.x, p.y, p.z, -dir.x * rand(0.5, 2) + rand(-0.6, 0.6), rand(-0.2, 0.8), -dir.z * rand(0.5, 2) + rand(-0.6, 0.6), 0.45, 0.03, 0.02, 0.9, rand(0.02, 0.05), 0.02, rand(0.3, 0.6), 9.8, 0.4, 1);
    for (let k = 0; k < 3; k++) alpha.add(p.x, p.y, p.z, dir.x * rand(0.3, 1) + rand(-0.3, 0.3), rand(-0.1, 0.3), dir.z * rand(0.3, 1) + rand(-0.3, 0.3), 0.4, 0.02, 0.015, 0.55, rand(0.15, 0.25), rand(0.5, 0.8), rand(0.35, 0.6), 0.5, 3);
  },
  muzzleSmoke(p, d) {
    for (let k = 0; k < 2; k++) alpha.add(p.x, p.y, p.z, d.x * rand(0.5, 1.5) + rand(-0.2, 0.2), d.y * rand(0.5, 1.5) + rand(0, 0.4), d.z * rand(0.5, 1.5) + rand(-0.2, 0.2), 0.75, 0.72, 0.68, 0.18, 0.08, 0.35, rand(0.4, 0.8), -0.4, 2);
  },
  fire(x, y, z, n) {
    for (let k = 0; k < n; k++) add.add(x + rand(-0.12, 0.12), y + rand(0, 0.1), z + rand(-0.12, 0.12), rand(-0.3, 0.3), rand(1, 2.4), rand(-0.3, 0.3), 3.2, rand(1.1, 1.7), 0.35, 0.9, rand(0.22, 0.4), 0.05, rand(0.35, 0.7), -0.5, 1.2);
    if (Math.random() < 0.3) alpha.add(x, y + 0.5, z, rand(-0.2, 0.2), rand(0.6, 1.2), rand(-0.2, 0.2), 0.15, 0.13, 0.12, 0.35, 0.25, 1.1, rand(1.2, 2), -0.2, 0.6);
  },
  /** Coloured signal smoke (supply flares) or dark damage smoke. */
  smoke(x, y, z, r, g, b, n = 1, size = 1) {
    for (let k = 0; k < n; k++) alpha.add(x + rand(-0.1, 0.1), y, z + rand(-0.1, 0.1), rand(-0.3, 0.3), rand(1.2, 2.2), rand(-0.3, 0.3), r, g, b, 0.5, 0.3 * size, rand(2, 3.2) * size, rand(2.5, 4), -0.15, 0.5);
  },
  explosion(p, big = false) {
    const s = big ? 1.6 : 1;
    for (let k = 0; k < 70 * s; k++) {
      const u = rand(-1, 1), a = rand(0, TAU), sq = Math.sqrt(1 - u * u), v = rand(2, 9) * s;
      add.add(p.x, p.y + 0.3, p.z, sq * Math.cos(a) * v, Math.abs(u) * v * 0.9 + 1, sq * Math.sin(a) * v, 4, rand(1.2, 2.2), 0.4, 1, rand(0.6, 1.2) * s, 0.2, rand(0.35, 0.8), -1, 3);
    }
    for (let k = 0; k < 40 * s; k++) {
      const a = rand(0, TAU), v = rand(0.5, 3.5) * s;
      alpha.add(p.x + rand(-0.5, 0.5), p.y + rand(0.2, 1.2), p.z + rand(-0.5, 0.5), Math.cos(a) * v, rand(0.8, 3), Math.sin(a) * v, 0.16, 0.14, 0.13, 0.6, rand(0.8, 1.4) * s, rand(2.6, 4.2) * s, rand(2.2, 4.2), -0.25, 1.1);
    }
    for (let k = 0; k < 40; k++) add.add(p.x, p.y + 0.3, p.z, rand(-12, 12), rand(4, 14), rand(-12, 12), 3.5, 1.6, 0.5, 1, 0.07, 0.03, rand(0.6, 1.4), 9.8, 0.3);
    for (let k = 0; k < 24 * s; k++) alpha.add(p.x, p.y + 0.3, p.z, rand(-8, 8), rand(3, 11), rand(-8, 8), 0.12, 0.1, 0.08, 1, 0.08, 0.06, rand(0.8, 1.6), 9.8, 0.2, 1);
  },
  /** Wind-blown sand around the camera during a storm. */
  storm(cam, intensity, dt) {
    const n = Math.floor(intensity * 90 * dt * 60 / 10);
    for (let k = 0; k < n; k++) {
      const x = cam.x + rand(-22, 22), z = cam.z + rand(-22, 22), y = rand(0.2, 7);
      alpha.add(x - 10, y, z, rand(9, 14), rand(-0.4, 0.6), rand(1, 3), 0.72, 0.56, 0.38, 0.32 * intensity, rand(0.8, 1.6), rand(2, 3.6), rand(1.6, 2.6), 0, 0.05);
    }
  },
  contrail(p) { alpha.add(p.x, p.y, p.z, rand(-0.3, 0.3), rand(-0.2, 0.2), rand(-0.3, 0.3), 0.9, 0.9, 0.92, 0.35, 1.2, 4.5, rand(3, 5), 0, 0.2); },
};
