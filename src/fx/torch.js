import * as THREE from 'three';
import { damp } from '../core/utils.js';
import { scene, camera, torch, vmTorch } from '../core/renderer.js';
import { tod } from '../core/sky.js';
import { TEX } from '../assets/textures.js';

/*
 * The weapon light (F). One spot light gives an even disc of light with a soft rim: no hot centre,
 * and about the same brightness on a wall one metre away as on one twenty metres away, so the
 * picture never washes out up close. On top of that, a very faint glow of light scattered in the
 * air along the beam (soft sprites, hidden by any wall in front of them) and dust motes that only
 * sparkle where the beam passes through them. Built on first use.
 */

const LEN = 9, TAN = 0.16, DUST = 170, BOX = new THREE.Vector3(6, 4, 10);
const HAZE = [2.6, 4.2, 6.2, 8.4];   // nothing right in front of the lens
let haze = null, dust = null, level = 0;
const dustUni = { uStrength: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3() }, uScale: { value: 500 }, uTan: { value: TAN } };
const _o = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
let base = null;

function build() {
  // scattered light along the beam: camera-facing glows at a few distances down the axis
  haze = [];
  _d.subVectors(torch.target.position, torch.position).normalize();
  for (const d of HAZE) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: 0xfff0dc, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    s.position.copy(torch.position).addScaledVector(_d, d);
    s.scale.setScalar(TAN * d * 2.6);
    s.renderOrder = 4;
    s.userData.d = d;
    camera.add(s);
    haze.push(s);
  }
  // dust: points scattered in a box that travels with the view, lit only inside the beam
  base = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { base[i * 3] = Math.random(); base[i * 3 + 1] = Math.random(); base[i * 3 + 2] = Math.random(); }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3).setUsage(THREE.DynamicDrawUsage));
  dust = new THREE.Points(dg, new THREE.ShaderMaterial({
    uniforms: dustUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: /* glsl */`
      uniform vec3 uOrigin, uDir; uniform float uScale, uTan, uStrength; varying float vA;
      void main() {
        vec3 d = position - uOrigin;
        float along = dot(d, uDir);
        float r = length(d - uDir * along);
        float inside = along > 0.4 ? smoothstep(uTan * along, uTan * along * 0.3, r) : 0.0;
        vA = uStrength * inside * clamp(1.0 - along / ${LEN.toFixed(1)}, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 0.02 * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() { float r = length(gl_PointCoord - 0.5); if (vA < 0.004 || r > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * vA * (1.0 - r * 2.0), 1.0); }`,
  }));
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  scene.add(dust);
}

/** Per frame: fade the light in or out, set the scattering, drift the dust. */
export function updateTorch(dt, on) {
  if (!haze) build();
  level += ((on ? 1 : 0) - level) * damp(20, dt);
  torch.intensity = level * 2.4;
  vmTorch.intensity = level * 0.1;
  // the beam itself only shows in the dark or in blowing sand
  const air = level * (0.003 + tod.night * 0.014 + tod.storm * 0.04);
  for (const s of haze) { s.visible = air > 0.001; s.material.opacity = air * (1 - s.userData.d / (LEN + 1)); }
  dustUni.uStrength.value = level * (0.2 + tod.night * 0.8 + tod.storm);
  dust.visible = level > 0.01;
  if (!dust.visible) return;
  camera.updateMatrixWorld();
  torch.getWorldPosition(_o);
  torch.target.getWorldPosition(_t);
  dustUni.uOrigin.value.copy(_o);
  dustUni.uDir.value.subVectors(_t, _o).normalize();
  dustUni.uScale.value = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  // the dust box follows the view; each mote stays put in the world and drifts on the air
  _c.copy(_o).addScaledVector(dustUni.uDir.value, BOX.z * 0.5);
  const p = dust.geometry.attributes.position, t = performance.now() * 0.001;
  for (let i = 0; i < DUST; i++) {
    const j = i * 3;
    base[j] = (base[j] + dt * (0.012 + Math.sin(t * 0.3 + i) * 0.01) + 1) % 1;
    base[j + 1] = (base[j + 1] + dt * Math.sin(t * 0.21 + i * 1.7) * 0.008 + 1) % 1;
    base[j + 2] = (base[j + 2] + dt * Math.cos(t * 0.17 + i) * 0.006 + 1) % 1;
    const x = _c.x - BOX.x / 2 + ((((base[j] * BOX.x - _c.x) % BOX.x) + BOX.x) % BOX.x);
    const y = _c.y - BOX.y / 2 + ((((base[j + 1] * BOX.y - _c.y) % BOX.y) + BOX.y) % BOX.y);
    const z = _c.z - BOX.z / 2 + ((((base[j + 2] * BOX.z - _c.z) % BOX.z) + BOX.z) % BOX.z);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
}
