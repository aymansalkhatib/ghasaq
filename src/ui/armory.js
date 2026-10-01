import * as THREE from 'three';
import { camera } from '../core/renderer.js';
import { models, VM, applySkin } from '../weapons/viewmodels.js';

/*
 * Armory turntable: while the loadout is open, the real first-person weapon model is borrowed
 * from the viewmodel scene, stripped of its hands and sleeves, and hung in front of the menu
 * camera so the main renderer draws it lit by the dusk sun. It sits inside a DOM rectangle
 * (the hero stage) and swings slowly. armoryHide() puts everything back exactly as it was,
 * and must run before a run starts.
 */

const pivot = new THREE.Group();   // placed in camera space
const spin = new THREE.Group();    // turntable rotation and fit scale
const holder = new THREE.Group();  // recentres the model on its bounding box
pivot.add(spin); spin.add(holder);
pivot.name = 'armoryPivot';

let cur = null;
let skinShown = null;
const _box = new THREE.Box3(), _b = new THREE.Box3(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _r = new THREE.Vector3();

function visibleChain(o, root) {
  for (let n = o; n && n !== root.parent; n = n.parent) if (!n.visible) return false;
  return true;
}

/** Show weapon `key` (rifle, smg, shotgun, dmr, pistol) with finish `skin`. */
export function armoryShow(key, skin) {
  if (skin && skin !== skinShown) { applySkin(skin); skinShown = skin; }
  if (cur && cur.key === key) return;
  armoryHide(true);
  const M = models[key];
  if (!M) return;
  const g = M.g;
  cur = { key, g, parent: g.parent, pos: g.position.clone(), quat: g.quaternion.clone(), scl: g.scale.clone(), vis: g.visible, hidden: [], t: 0 };
  const hands = new Set([VM.glove, VM.sleeve, VM.patch]);
  g.traverse((o) => {
    if (o.isMesh && o.visible && (hands.has(o.material) || o.material === VM.flash)) { o.visible = false; cur.hidden.push(o); }
  });
  if (M.flash && M.flash.visible) { M.flash.visible = false; cur.hidden.push(M.flash); }
  // measure the bare weapon with everything at identity (pivot detached)
  if (pivot.parent) pivot.parent.remove(pivot);
  pivot.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0);
  spin.rotation.set(0, 0, 0); spin.scale.setScalar(1);
  holder.position.set(0, 0, 0);
  holder.add(g);
  g.position.set(0, 0, 0); g.quaternion.identity(); g.scale.set(1, 1, 1); g.visible = true;
  pivot.updateMatrixWorld(true);
  _box.makeEmpty();
  g.traverse((o) => {
    if (!o.isMesh || !visibleChain(o, g)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    _box.union(_b);
  });
  if (_box.isEmpty()) _box.set(_p.set(-0.1, -0.1, -0.4), _q.set(0.1, 0.1, 0.4));
  cur.size = _box.getSize(new THREE.Vector3());
  holder.position.copy(_box.getCenter(_p)).negate();
  camera.add(pivot);
}

/** Put the borrowed model back into the first-person rig. */
export function armoryHide(keepSkin) {
  if (!cur) return;
  const { g } = cur;
  for (const o of cur.hidden) o.visible = true;
  cur.parent.add(g);
  g.position.copy(cur.pos); g.quaternion.copy(cur.quat); g.scale.copy(cur.scl); g.visible = cur.vis;
  if (pivot.parent) pivot.parent.remove(pivot);
  cur = null;
  if (!keepSkin) skinShown = null;
}
export const armoryActive = () => !!cur;

/** Unproject a screen point (px) to camera space at distance d (works with a view offset). */
function toCam(x, y, d, out) {
  out.set((x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2, 0.5).applyMatrix4(camera.projectionMatrixInverse);
  return out.multiplyScalar(-d / out.z);
}

/** Fit and animate the weapon inside `rect` (a DOMRect of the hero stage). */
export function armoryUpdate(dt, rect) {
  if (!cur || !rect || rect.width < 20 || rect.height < 20) { pivot.visible = false; return; }
  pivot.visible = true;
  cur.t += dt;
  const D = 1.6;
  toCam(rect.left + rect.width / 2, rect.top + rect.height / 2, D, pivot.position);
  toCam(rect.left, rect.top, D, _q);
  toCam(rect.right, rect.bottom, D, _r);
  const w = Math.abs(_r.x - _q.x), h = Math.abs(_q.y - _r.y);
  const len = Math.max(cur.size.z, 0.05), tall = Math.max(cur.size.y, 0.05);
  const s = Math.min((w * 0.86) / len, (h * 0.8) / tall);
  // a quick swing-in when the weapon changes, then a slow turntable sway showing its right side
  const intro = Math.exp(-cur.t * 3.2);
  spin.scale.setScalar(s * (1 - intro * 0.12));
  spin.rotation.set(0.06 + Math.sin(cur.t * 0.41) * 0.05, -Math.PI / 2 + Math.sin(cur.t * 0.33) * 0.32 + intro * 1.1, Math.sin(cur.t * 0.27) * 0.03);
}
