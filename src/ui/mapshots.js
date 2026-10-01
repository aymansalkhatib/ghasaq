import * as THREE from 'three';
import { renderer, composer, camera, keyLight, scene } from '../core/renderer.js';
import { sky, tod } from '../core/sky.js';
import { store } from '../core/utils.js';
import { MAP_DEFS, MAP_INFO, loadMap } from '../world/map.js';

/*
 * Map thumbnails for the briefing: each map is rendered once from a high aerial camera through
 * the full post chain, cropped to 16:10 and kept as a JPEG data URL. The cache is keyed by a
 * signature of the map's source, so editing a map re-renders its picture automatically.
 */

const KEY = 'ghasaq.mapshots.v1';
const TW = 480, TH = 300;
let cache = null;
export const shots = {};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const sigs = {};
function sig(id) {
  if (!sigs[id]) {
    const def = MAP_DEFS[id];
    sigs[id] = hash(JSON.stringify(def, (k, v) => (typeof v === 'function' ? String(v) : v)) + TW + 'x' + TH);
  }
  return sigs[id];
}
// read lazily: this module is imported while the map modules may still be initialising
function init() {
  if (cache) return;
  cache = store.get(KEY, {}) || {};
  for (const id of Object.keys(MAP_DEFS)) if (cache[id] && cache[id].sig === sig(id)) shots[id] = cache[id].url;
}
export function missingShots() { init(); return Object.keys(MAP_DEFS).filter((id) => !shots[id]); }

const capCam = new THREE.PerspectiveCamera(34, 1, 1, 1400);
const out = document.createElement('canvas');
out.width = TW; out.height = TH;

/**
 * Render the loaded map from the air and return a data URL. It draws straight into a small
 * scissored corner of the game canvas (tone mapped, no post chain), copies the pixels out and
 * repaints the normal view, so it costs one small render and never shows on screen.
 */
function capture() {
  const canvas = renderer.domElement, pr = renderer.getPixelRatio();
  const tw = Math.min(TW, canvas.width, Math.floor((canvas.height * TW) / TH)), th = Math.round((tw * TH) / TW);
  capCam.aspect = TW / TH;
  capCam.updateProjectionMatrix();
  const a = 0.62, R = 76, Hh = 70;
  capCam.position.set(Math.sin(a) * R, Hh, Math.cos(a) * R);
  capCam.lookAt(0, -2, 0);
  capCam.updateMatrixWorld();
  // light the whole map: move the shadow frustum over it and thin the fog for the aerial view
  const sc = keyLight.shadow.camera, saved = { l: sc.left, r: sc.right, t: sc.top, b: sc.bottom, fog: scene.fog.density, sky: sky.position.clone(), tp: keyLight.target.position.clone(), kp: keyLight.position.clone() };
  sc.left = -66; sc.right = 66; sc.top = 66; sc.bottom = -66; sc.updateProjectionMatrix();
  keyLight.target.position.set(0, 0, 0);
  keyLight.position.copy(tod.keyDir).multiplyScalar(120);
  keyLight.target.updateMatrixWorld();
  scene.fog.density = saved.fog * 0.35;
  sky.position.copy(capCam.position);
  renderer.setRenderTarget(null);
  renderer.setViewport(0, 0, tw / pr, th / pr);
  renderer.setScissor(0, 0, tw / pr, th / pr);
  renderer.setScissorTest(true);
  renderer.render(scene, capCam);
  const c = out.getContext('2d');
  c.drawImage(canvas, 0, canvas.height - th, tw, th, 0, 0, TW, TH);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, canvas.width / pr, canvas.height / pr);
  renderer.setScissor(0, 0, canvas.width / pr, canvas.height / pr);
  sc.left = saved.l; sc.right = saved.r; sc.top = saved.t; sc.bottom = saved.b; sc.updateProjectionMatrix();
  scene.fog.density = saved.fog;
  sky.position.copy(saved.sky);
  keyLight.target.position.copy(saved.tp); keyLight.position.copy(saved.kp);
  composer.render();  // repaint the normal view straight away
  return out.toDataURL('image/jpeg', 0.85);
}

function save(id, url) {
  init();
  shots[id] = url;
  cache[id] = { sig: sig(id), url };
  try { store.set(KEY, cache); } catch { /* storage full or blocked: keep it for this session */ }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
/**
 * Render every map that has no picture yet. `beforeLoad` / `afterRestore` let the caller clear
 * and rebuild the menu backdrop around the temporary map switches. Returns the ids rendered.
 */
export async function renderMissingShots(beforeLoad, afterRestore) {
  const todo = missingShots();
  if (!todo.length) return todo;
  const home = MAP_INFO.id;
  if (todo.includes(home)) { await frame(); save(home, capture()); }
  let switched = false;
  for (const id of todo) {
    if (id === home) continue;
    if (!switched) { beforeLoad?.(); switched = true; }
    loadMap(id);
    await frame();
    save(id, capture());
  }
  if (switched) { loadMap(home); afterRestore?.(); }
  return todo;
}
