import * as THREE from 'three';
import { clamp, lerp } from './utils.js';
import { renderer, scene, hemi, keyLight, vmHemi, vmKey, vmScene } from './renderer.js';

/* Sky dome and the full 24-hour time-of-day system (sun, moon, stars, fog, exposure, lamps). */

export const skyUniforms = {
  uSun: { value: new THREE.Vector3(0, 1, 0) },
  uMoon: { value: new THREE.Vector3(0, 1, 0) },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color(0x5a4a3a) },
  uSunCol: { value: new THREE.Color() },
  uStars: { value: 0 },
  uSunVis: { value: 1 },
  uTime: { value: 0 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform vec3 uSun, uMoon, uZenith, uHorizon, uGround, uSunCol;
    uniform float uStars, uSunVis, uTime;
    varying vec3 vDir;
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
      col = mix(col, uGround, smoothstep(0.0, -0.14, h));
      float s = max(dot(d, uSun), 0.0);
      col += uSunCol * (pow(s, 1400.0) * 36.0 * uSunVis + pow(s, 18.0) * 0.5 + pow(s, 4.0) * 0.16);
      float m = max(dot(d, uMoon), 0.0);
      col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.9997, m) * 3.0 + pow(m, 80.0) * 0.1) * uStars;
      vec3 cell = floor(d * 420.0);
      float st = step(0.9978, hash(cell)) * smoothstep(0.03, 0.3, h);
      float tw = 0.55 + 0.45 * sin(uTime * 2.5 + hash(cell + 7.0) * 60.0);
      col += vec3(st * tw * 1.6) * uStars;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
export const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
sky.renderOrder = -10;
sky.frustumCulled = false;
scene.add(sky);

/*
 * Keyframes across a whole day. el/az are the sun's elevation and azimuth in degrees
 * (azimuth 0 = north, 90 = east). Night keys light the scene with moonlight instead.
 */
const K = (h, el, az, sun, sunI, sky, gnd, hemiI, zen, hor, fog, fogD, exp, stars, lamps, env) => ({ h, el, az, sun, sunI, sky, gnd, hemiI, zen, hor, fog, fogD, exp, stars, lamps, env });
const TOD = [
  K(0, -34, 330, 0x9fb2f0, 0.44, 0x2c3460, 0x18161e, 0.38, 0x050918, 0x161a2e, 0x12141f, 0.0135, 1.5, 1, 1, 0.18),
  K(3, -24, 20, 0x9fb2f0, 0.44, 0x2e3662, 0x19171f, 0.38, 0x060a1a, 0x181c30, 0x131520, 0.0135, 1.5, 1, 1, 0.18),
  K(5, -6, 62, 0x8f9fd8, 0.5, 0x5a6390, 0x2a2630, 0.5, 0x16224a, 0x8a6a8a, 0x3c3a52, 0.012, 1.3, 0.5, 0.9, 0.25),
  K(6, 2, 72, 0xff8a50, 1.6, 0x9aa0c8, 0x7a5a48, 0.62, 0x35508c, 0xf09060, 0xc08a78, 0.011, 1.1, 0.08, 0.5, 0.35),
  K(7, 12, 82, 0xffc488, 2.7, 0xc8d4ee, 0x9a7a58, 0.85, 0x4270b8, 0xf4c49c, 0xe2c4a4, 0.009, 1.0, 0, 0.05, 0.45),
  K(10, 45, 115, 0xfff6e6, 3.5, 0xd8e8ff, 0xb4925f, 1.1, 0x3570c8, 0xe9dcc4, 0xe0d4bc, 0.007, 0.88, 0, 0, 0.55),
  K(13, 68, 180, 0xfffaf0, 3.6, 0xdcebff, 0xb8965f, 1.15, 0x3068c4, 0xe6dcc8, 0xe2d6c0, 0.007, 0.86, 0, 0, 0.58),
  K(16, 36, 235, 0xfff1da, 3.4, 0xd4e6ff, 0xb08c5c, 1.05, 0x3a74c4, 0xeed9b8, 0xe3d2b4, 0.0072, 0.9, 0, 0, 0.55),
  K(17, 24, 245, 0xffe2b5, 3.2, 0xd0ddf5, 0xae8658, 0.95, 0x4176c0, 0xf5caa0, 0xe8c9a3, 0.008, 0.95, 0, 0, 0.5),
  K(18, 11, 252, 0xffb574, 2.8, 0xc3c8e6, 0x9a6f4c, 0.8, 0x3d62a0, 0xff9f63, 0xe0a07a, 0.0095, 1.0, 0, 0.15, 0.45),
  K(19, 1.5, 258, 0xff7442, 1.5, 0x8d8cb8, 0x6c4b3e, 0.6, 0x2b3f74, 0xd8674a, 0x8f5f58, 0.011, 1.1, 0.15, 0.7, 0.35),
  K(20, -8, 265, 0x8fa2e0, 0.6, 0x4a5484, 0x2c2630, 0.5, 0x101c3c, 0x3e3858, 0x2c2b3e, 0.012, 1.3, 0.75, 1, 0.25),
  K(22, -20, 290, 0x9fb2f0, 0.5, 0x3a4470, 0x1e1c24, 0.42, 0x070c1e, 0x1e2238, 0x171a28, 0.013, 1.45, 1, 1, 0.2),
  K(24, -34, 330, 0x9fb2f0, 0.44, 0x2c3460, 0x18161e, 0.38, 0x050918, 0x161a2e, 0x12141f, 0.0135, 1.5, 1, 1, 0.18),
];
const MOON = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(180 - 115));
const STORM_FOG = new THREE.Color(0xb88a58);

/** Shared time-of-day state read by other systems. `storm` (0..1) is written by the weather. */
export const tod = { hour: 18.4, lamps: 0, night: 0, storm: 0, keyDir: new THREE.Vector3(), sunDir: new THREE.Vector3(), isSun: true, lastEnvHour: -99 };
export const todHooks = [];
const ca = new THREE.Color(), cb = new THREE.Color();
const mixHex = (a, b, t, out) => out.copy(ca.setHex(a)).lerp(cb.setHex(b), t);
const deg = THREE.MathUtils.degToRad;
// azimuth measured from north (-Z) clockwise towards east (+X)
const dirFromAzEl = (az, el, out) => out.set(Math.cos(deg(el)) * Math.sin(deg(az)), Math.sin(deg(el)), -Math.cos(deg(el)) * Math.cos(deg(az)));

export function applyTOD(hour) {
  tod.hour = hour;
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < TOD.length - 2 && h >= TOD[i + 1].h) i++;
  const a = TOD[i], b = TOD[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h), 0, 1);
  const n = (k) => lerp(a[k], b[k], t);
  let az = b.az - a.az;
  if (az < -180) az += 360;
  const elDeg = n('el');
  dirFromAzEl(a.az + az * t, elDeg, tod.sunDir);
  const sunVis = clamp((elDeg + 3) / 5, 0, 1);
  tod.isSun = sunVis >= 0.5;
  tod.keyDir.copy(tod.isSun ? tod.sunDir : MOON);
  const handover = Math.abs(sunVis - 0.5) * 2;
  const storm = tod.storm;

  mixHex(a.sun, b.sun, t, keyLight.color);
  keyLight.intensity = n('sunI') * handover * (1 - storm * 0.55);
  mixHex(a.sky, b.sky, t, hemi.color);
  mixHex(a.gnd, b.gnd, t, hemi.groundColor);
  hemi.intensity = n('hemiI') * (1 + storm * 0.15);
  mixHex(a.fog, b.fog, t, scene.fog.color);
  scene.fog.color.lerp(ca.copy(STORM_FOG).multiplyScalar(0.25 + n('hemiI') * 0.6), storm * 0.85);
  scene.fog.density = n('fogD') + storm * 0.034;
  renderer.toneMappingExposure = n('exp');
  scene.environmentIntensity = n('env');

  skyUniforms.uSun.value.copy(tod.sunDir);
  skyUniforms.uMoon.value.copy(MOON);
  mixHex(a.zen, b.zen, t, skyUniforms.uZenith.value).lerp(scene.fog.color, storm * 0.8);
  mixHex(a.hor, b.hor, t, skyUniforms.uHorizon.value).lerp(scene.fog.color, storm * 0.9);
  mixHex(a.sun, b.sun, t, skyUniforms.uSunCol.value).multiplyScalar(1 - storm * 0.8);
  skyUniforms.uSunVis.value = clamp((tod.sunDir.y + 0.03) * 12, 0, 1);
  skyUniforms.uStars.value = n('stars') * (1 - storm);
  skyUniforms.uGround.value.copy(scene.fog.color).multiplyScalar(0.55);

  vmHemi.color.copy(hemi.color);
  vmHemi.groundColor.copy(hemi.groundColor);
  vmHemi.intensity = Math.max(0.95, hemi.intensity * 1.2);
  vmKey.color.copy(keyLight.color);
  vmKey.intensity = keyLight.intensity * 0.8;

  tod.lamps = n('lamps');
  tod.night = clamp((2 - elDeg) / 8, 0, 1);
  for (const f of todHooks) f(tod);
  // the reflection map is rebuilt about once per in-game hour, which lands in the calm between waves
  // (a rebuild costs a few milliseconds, so it never happens in the middle of a fight)
  if (Math.abs(hour - tod.lastEnvHour) > 0.95) { tod.lastEnvHour = hour; rebuildEnv(); }
}

/* image-based lighting generated from the sky itself */
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
let envRT = null;
export function rebuildEnv() {
  const stars = skyUniforms.uStars.value;
  skyUniforms.uStars.value = 0;
  const next = pmrem.fromScene(envScene, 0.03);
  skyUniforms.uStars.value = stars;
  if (envRT) envRT.dispose();
  envRT = next;
  scene.environment = envRT.texture;
  vmScene.environment = envRT.texture;
}
