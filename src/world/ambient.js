import * as THREE from 'three';
import { TAU, rand, damp } from '../core/utils.js';
import { scene } from '../core/renderer.js';
import { tod } from '../core/sky.js';
import { MAT } from '../assets/materials.js';
import { TEX } from '../assets/textures.js';
import { lanternSpots, brazierSpots } from './builder.js';
import { FLAG_SPOTS, MAP_INFO } from './map.js';
import { fx } from '../fx/particles.js';
import { sfx } from '../audio/sfx.js';

/* Living details: lantern and brazier light, waving banners, a flock of birds, rippling water. */

const lampLights = [];
const flags = [];
const birds = [];
const flock = { scatter: 0, center: new THREE.Vector3(0, 27, 0), away: new THREE.Vector3() };

let poleGeo = null;
/** Lamps and flags belong to the map: rebuilt whenever a map is loaded. */
export function rebuildAmbient() {
  for (const l of lampLights) scene.remove(l);
  lampLights.length = 0;
  for (const f of flags) { scene.remove(f.mesh); scene.remove(f.pole); f.mesh.geometry.dispose(); }
  flags.length = 0;
  flock.center.copy(MAP_INFO.birds);

  [...lanternSpots.slice(0, 4), ...brazierSpots].forEach((p, i) => {
    const l = new THREE.PointLight(i < 4 ? 0xffb35c : 0xff8a3a, 0, i < 4 ? 15 : 20, 2);
    l.position.copy(p);
    l.userData.brazier = i >= 4;
    scene.add(l);
    lampLights.push(l);
  });

  poleGeo ||= new THREE.CylinderGeometry(0.045, 0.06, 3.4, 8);
  for (const p of FLAG_SPOTS) {
    const pole = new THREE.Mesh(poleGeo, MAT.metal);
    pole.position.set(p.x, p.y + 1.7, p.z);
    pole.castShadow = true;
    scene.add(pole);
    const geo = new THREE.PlaneGeometry(2.2, 1.35, 18, 9);
    geo.translate(1.1, 0, 0);
    const mesh = new THREE.Mesh(geo, MAT.flag);
    mesh.position.set(p.x, p.y + 2.7, p.z);
    mesh.rotation.y = -0.35;   // the evening wind blows from the west
    mesh.castShadow = true;
    scene.add(mesh);
    flags.push({ mesh, pole, base: Float32Array.from(geo.attributes.position.array), phase: rand(0, TAU), frame: 0 });
  }
}

/** The flock of birds is created once and follows whichever map is loaded. */
export function initAmbient() {
  const birdMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9, side: THREE.DoubleSide });
  const bodyGeo = new THREE.BoxGeometry(0.08, 0.06, 0.3);
  const wingGeo = new THREE.PlaneGeometry(0.42, 0.16).translate(0.21, 0, 0).rotateX(-Math.PI / 2);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(bodyGeo, birdMat));
    const wl = new THREE.Mesh(wingGeo, birdMat), wr = new THREE.Mesh(wingGeo, birdMat);
    wr.scale.x = -1;
    g.add(wl, wr);
    scene.add(g);
    const b = { g, wl, wr, a: rand(0, TAU), r: rand(18, 34), h: rand(-4, 6), speed: rand(0.18, 0.3), flap: rand(0, TAU), dir: new THREE.Vector3() };
    // start on their circuit high over the map, not in a heap at the origin
    g.position.set(Math.cos(b.a) * b.r, flock.center.y + b.h, Math.sin(b.a) * b.r);
    birds.push(b);
  }
}

/** Gunfire and explosions send the flock away for a while. */
export function scatterBirds() {
  if (flock.scatter > 0.5 || tod.night > 0.6) return;
  flock.scatter = 14;
  sfx.flutter(flock.center);
  for (const b of birds) b.dir.set(rand(-1, 1), rand(0.5, 1), rand(-1, 1)).normalize();
}

export function updateAmbient(dt) {
  const t = performance.now() * 0.001;
  for (let i = 0; i < lampLights.length; i++) {
    const l = lampLights[i], br = l.userData.brazier;
    const flick = 0.82 + Math.sin(t * (br ? 13 : 7) + i * 3) * 0.08 + Math.sin(t * (br ? 29 : 17) + i) * 0.06 + (br ? Math.random() * 0.08 : 0);
    l.intensity = tod.lamps * (br ? 34 : 16) * flick;
  }
  MAT.windowGlow.emissiveIntensity = tod.lamps * 1.7;
  MAT.lantern.emissiveIntensity = tod.lamps * 5;
  MAT.embers.emissiveIntensity = 0.12 + tod.lamps * (2.4 + Math.sin(t * 9) * 0.3);
  if (tod.lamps > 0.05) for (const b of brazierSpots) if (Math.random() < tod.lamps) fx.fire(b.x, b.y, b.z, 2);

  for (const f of flags) {
    f.frame++;
    const pos = f.mesh.geometry.attributes.position, base = f.base, gust = 0.8 + Math.sin(t * 0.7 + f.phase) * 0.3 + tod.storm * 0.8;
    for (let v = 0; v < pos.count; v++) {
      const x = base[v * 3], y = base[v * 3 + 1], k = x / 2.2;
      pos.setZ(v, (Math.sin(x * 2.4 - t * 5.5 * gust + y * 1.2 + f.phase) * 0.15 + Math.sin(x * 5.1 - t * 9 + f.phase) * 0.035) * k * gust);
      pos.setY(v, y - k * 0.08 * (1.2 - gust));
    }
    pos.needsUpdate = true;
    if (f.frame % 3 === 0) f.mesh.geometry.computeVertexNormals();
  }

  const visible = tod.night < 0.65;
  flock.scatter = Math.max(0, flock.scatter - dt);
  for (const b of birds) {
    b.g.visible = visible;
    if (!visible) continue;
    b.flap += dt * (flock.scatter > 0 ? 22 : 11);
    const w = Math.sin(b.flap) * 0.75;
    b.wl.rotation.z = w; b.wr.rotation.z = -w;
    b.a += dt * b.speed;
    const home = new THREE.Vector3(Math.cos(b.a) * b.r, flock.center.y + b.h + Math.sin(b.a * 2) * 1.5, Math.sin(b.a) * b.r);
    if (flock.scatter > 0) {
      flock.away.copy(b.dir).multiplyScalar(dt * 14);
      b.g.position.add(flock.away);
    } else {
      b.g.position.lerp(home, damp(0.6, dt));
    }
    const heading = flock.scatter > 0 ? Math.atan2(b.dir.x, b.dir.z) : -b.a;
    b.g.rotation.set(0, heading, Math.sin(b.a * 3) * 0.2);
  }

  if (TEX.waterN) { TEX.waterN.offset.x += dt * 0.018; TEX.waterN.offset.y += dt * 0.011; }
}
