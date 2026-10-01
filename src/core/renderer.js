import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { settings, QUALITY } from '../config/settings.js';

/* Renderer, scenes, cameras, lights and the post-processing chain. */

export const canvas = document.getElementById('game');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
export const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

/** The active quality preset (mutated in place by applyQuality). */
export const Q = { ...QUALITY[settings.quality] };
let resScale = 1;
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, Q.pr) * resScale;
export const getResScale = () => resScale;
/** Dynamic resolution: a render-scale multiplier applied on top of the quality preset. */
export function setResScale(s) {
  if (Math.abs(s - resScale) < 0.01) return;
  resScale = s;
  onResize();
}

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xe3d2b4, 0.008);
export const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 1400);
camera.rotation.order = 'YXZ';
scene.add(camera);

// the first-person weapon lives in its own scene so it never clips into walls
export const vmScene = new THREE.Scene();
export const vmCamera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.01, 10);

/* ---- lights ---- */
export const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
scene.add(hemi);
export const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(Q.shadow, Q.shadow);
Object.assign(keyLight.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 300 });
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.035;
scene.add(keyLight, keyLight.target);

// weapon light: one even disc of light (no hot centre) with a soft rim. decay 0 means a wall 1 m
// away is lit about as brightly as one 20 m away; the light only fades out past ~30 m.
// Mounted low on the right of the gun, converging on the crosshair ~15 m out. Always present so
// toggling never recompiles shaders.
export const torch = new THREE.SpotLight(0xfff2e4, 0, 42, 0.37, 0.3, 0);
torch.position.set(0.14, -0.1, -0.2);
torch.target.position.set(0, -0.02, -15);
camera.add(torch, torch.target);

export const vmHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
export const vmKey = new THREE.DirectionalLight(0xffffff, 2);
export const vmFlash = new THREE.PointLight(0xffb070, 0, 2.5, 2);
vmFlash.position.set(0.12, -0.05, -0.9);
// the weapon light's spill on the gun's own handguard and the support hand
export const vmTorch = new THREE.PointLight(0xfff1dc, 0, 1.4, 2);
vmTorch.position.set(0.32, -0.12, -1.05);
vmScene.add(vmHemi, vmKey, vmFlash, vmTorch);

/* ---- post-processing ---- */
class OverlayPass extends Pass {
  constructor(sc, cam) { super(); this.sc = sc; this.cam = cam; this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    r.clearDepth();
    r.render(this.sc, this.cam);
    r.autoClear = ac;
  }
}
const composerRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.samples });
export const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OverlayPass(vmScene, vmCamera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.92);
bloom.enabled = Q.bloom;
composer.addPass(bloom);
export const grade = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uLow: { value: 0 }, uFocus: { value: 0 },
    uFlash: { value: 0 }, uDead: { value: 0 }, uVig: { value: 0.55 }, uGrain: { value: 1 }, uScope: { value: 0 }, uSupp: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uHurt, uLow, uFocus, uFlash, uDead, uVig, uGrain, uScope, uSupp;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec2 off = c * (0.0015 + uFocus * 0.006 + uHurt * 0.006 + uSupp * 0.005);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l), clamp(uLow * 0.65 + uDead * 0.85 + uFocus * 0.45 + uSupp * 0.3 * smoothstep(0.1, 0.6, r), 0.0, 1.0));
      col *= mix(vec3(1.0), vec3(1.18, 0.98, 0.78), uFocus);
      col = mix(col, col * vec3(1.25, 0.35, 0.3), uHurt * smoothstep(0.15, 0.75, r));
      col *= 1.0 - smoothstep(0.4, 0.95, r) * (uVig + uFocus * 0.5 + uLow * 0.35 + uDead * 0.4 + uSupp * 0.45);
      float n = fract(sin(dot(vUv * vec2(1733.0, 911.0) + uTime * 47.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.018 * uGrain;
      col += vec3(1.0, 0.85, 0.65) * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

export function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h);
  composer.setPixelRatio(pixelRatio());
  composer.setSize(w, h);
  camera.aspect = vmCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
}

/** Re-applies the quality preset from settings (pixel ratio, shadows, bloom, MSAA). */
export function applyQuality() {
  Object.assign(Q, QUALITY[settings.quality]);
  bloom.enabled = Q.bloom;
  grade.uniforms.uGrain.value = settings.grain ? 1 : 0;
  if (keyLight.shadow.mapSize.x !== Q.shadow) {
    keyLight.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
  }
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (rt.samples !== Q.samples) { rt.samples = Q.samples; rt.dispose(); }
  }
  onResize();
}
onResize();
grade.uniforms.uGrain.value = settings.grain ? 1 : 0;
