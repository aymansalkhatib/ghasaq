import * as THREE from 'three';
import { scene } from '../core/renderer.js';
import { pickups, colliders } from '../core/state.js';
import { GRENADE, WEAPONS, PRIMARIES } from '../config/balance.js';
import { MAT, std } from '../assets/materials.js';
import { TEX } from '../assets/textures.js';
import { supportHeight } from '../world/collision.js';
import { fx } from '../fx/particles.js';
import { sfx } from '../audio/sfx.js';
import { radio } from '../audio/radio.js';
import { player } from '../entities/player.js';
import { inv, refillAmmo, giveWeapon } from '../weapons/arsenal.js';
import { WEAPON_ICONS } from '../ui/icons.js';
import { showMsg, updateAmmoHUD, setPrompt } from '../ui/hud.js';

/*
 * Medkits and ammo boxes dropped by raiders, and parachuted supply crates. A crate refills
 * everything when you reach it and also carries a weapon you can take with E (the use key).
 */

let mats = null;
function initMats() {
  mats = {
    med: std({ color: 0xe8e2d6, roughness: 0.5 }),
    cross: std({ color: 0x400000, emissive: 0xff2a1a, emissiveIntensity: 2 }),
    ammo: std({ color: 0x4f5634, roughness: 0.6 }),
    glow: new THREE.SpriteMaterial({ map: TEX.soft, color: new THREE.Color(1.6, 1.3, 0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  };
}
const box = (g, w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };

export function spawnPickup(at, kind) {
  if (!mats) initMats();
  const g = new THREE.Group();
  if (kind === 'med') {
    box(g, 0.36, 0.2, 0.26, mats.med, 0, 0, 0);
    box(g, 0.2, 0.06, 0.02, mats.cross, 0, 0, 0.135); box(g, 0.06, 0.2, 0.02, mats.cross, 0, 0, 0.135);
    box(g, 0.2, 0.06, 0.02, mats.cross, 0, 0, -0.135); box(g, 0.06, 0.2, 0.02, mats.cross, 0, 0, -0.135);
  } else {
    box(g, 0.4, 0.2, 0.24, mats.ammo, 0, 0, 0);
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8), MAT.brass); b.position.set(-0.12 + k * 0.05, 0.13, 0); g.add(b); }
  }
  const s = new THREE.Sprite(mats.glow); s.scale.set(1.1, 1.1, 1); s.position.y = -0.05; g.add(s);
  g.position.set(at.x, supportHeight(at.x, at.z, at.y + 0.5) + 0.35, at.z);
  scene.add(g);
  pickups.push({ g, kind, t: 0, y: g.position.y });
}

/** A floating holographic card over the crate showing the weapon on offer. */
function weaponHolo(key) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,30,18,.55)'; ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(127,224,160,.9)'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, 500, 244);
  const d = (WEAPON_ICONS[key].match(/ d="([^"]+)"/g) || []).map((m) => m.slice(4, -1));
  ctx.save(); ctx.translate(96, 30); ctx.scale(5, 5); ctx.fillStyle = '#bff5cf';
  for (const p of d) ctx.fill(new Path2D(p));
  ctx.restore();
  ctx.fillStyle = '#e8fff0'; ctx.textAlign = 'center';
  ctx.font = '700 44px Changa, "Segoe UI", sans-serif';
  ctx.fillText(WEAPONS[key].full, 256, 200);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.5, 0.75, 1);
  sp.position.y = 1.85;
  return sp;
}

/** A landed crate: solid, beaconing, trailing thin green smoke until it is emptied. */
export function addSupplyCrate(c, pos) {
  c.g.position.copy(pos);
  const choices = PRIMARIES.filter((k) => !inv.primaries.includes(k));
  const offer = choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
  const holo = offer ? weaponHolo(offer) : null;
  if (holo) c.g.add(holo);
  const col = { min: new THREE.Vector3(pos.x - 0.68, pos.y, pos.z - 0.56), max: new THREE.Vector3(pos.x + 0.68, pos.y + 1.0, pos.z + 0.56) };
  colliders.push(col);
  // never trap the player inside a crate that lands on top of them
  const dx = player.pos.x - pos.x, dz = player.pos.z - pos.z, ox = 0.68 + 0.42 - Math.abs(dx), oz = 0.56 + 0.42 - Math.abs(dz);
  if (ox > 0 && oz > 0) { if (ox < oz) player.pos.x += Math.sign(dx || 1) * ox; else player.pos.z += Math.sign(dz || 1) * oz; }
  pickups.push({ g: c.g, kind: 'supply', crate: c, t: 0, y: pos.y, opened: false, offer, holo, col });
}
function removeSupply(p) {
  const i = colliders.indexOf(p.col);
  if (i >= 0) colliders.splice(i, 1);
  scene.remove(p.g);
}

let nearOffer = null;
/** The use key: take the weapon from the nearest crate. Returns true if something was taken. */
export function useNearest() {
  const p = nearOffer;
  if (!p || !p.offer) return false;
  const key = p.offer;
  giveWeapon(key);
  p.offer = null;
  if (p.holo) { p.g.remove(p.holo); p.holo = null; }
  showMsg(`أخذت ${WEAPONS[key].full} · اضغط 1 للتبديل بين سلاحيك الأساسيين`, 2600);
  sfx.select();
  return true;
}

export function updatePickups(dt) {
  nearOffer = null;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    const d = Math.hypot(p.g.position.x - player.pos.x, p.g.position.z - player.pos.z);
    if (p.kind === 'supply') {
      if (p.holo) { p.holo.position.y = 1.85 + Math.sin(p.t * 2) * 0.06; p.holo.material.opacity = 0.75 + Math.sin(p.t * 5) * 0.2; }
      if (!p.opened) {
        // a thin column of signal smoke that rises well above head height
        if (Math.random() < 0.35) fx.smoke(p.g.position.x + 0.66, p.g.position.y + 0.45, p.g.position.z + 0.52, 0.3, 0.85, 0.35, 1, 0.55);
        p.crate.strobe.visible = (p.t * 2) % 1 < 0.2;
        if (player.alive && d < 2.3) {
          p.opened = true;
          player.heal(50, 100);
          player.armor = 100;
          refillAmmo(1);
          inv.nades = GRENADE.max;
          updateAmmoHUD(true);
          sfx.select(); sfx.click(900, 0.5); sfx.click(1300, 0.5, 0.1);
          showMsg('إمداد كامل: ذخيرة، ودرع، وقنابل، وإسعاف', 2200);
          radio(p.offer ? `استلمت الإمداد. في الصندوق ${WEAPONS[p.offer].full} إن أردته.` : 'استلمت الإمداد. عُد إلى القتال.', 'hq');
        }
      } else {
        const k = Math.min(1, p.t * 2);
        p.crate.lid.rotation.x = -1.2 * k;
        p.crate.lid.position.set(0, 0.98 + 0.25 * k, -0.5 * k);
        p.crate.strobe.visible = false;
      }
      if (p.offer && player.alive && d < 2.4) nearOffer = p;
      if (p.opened && !p.offer && p.t > 40) { removeSupply(p); pickups.splice(i, 1); }
      continue;
    }
    p.g.rotation.y += dt * 1.6;
    p.g.position.y = p.y + Math.sin(p.t * 2.5) * 0.06;
    if (player.alive && d < 1.3) {
      if (p.kind === 'med') { player.heal(35); showMsg('حقيبة إسعاف · +٣٥ صحة', 1300); }
      else {
        refillAmmo(0.18);
        if (Math.random() < 0.35) inv.nades = Math.min(GRENADE.max, inv.nades + 1);
        showMsg('صندوق ذخيرة', 1100);
        updateAmmoHUD(true);
      }
      sfx.select(); sfx.click(2000, 0.3, 0.05);
      scene.remove(p.g); pickups.splice(i, 1);
    } else if (p.t > 32) { scene.remove(p.g); pickups.splice(i, 1); }
  }
  setPrompt(nearOffer ? `اضغط E لأخذ ${WEAPONS[nearOffer.offer].full}` : '');
}
export function clearPickups() {
  for (const p of pickups) { if (p.kind === 'supply') removeSupply(p); else scene.remove(p.g); }
  pickups.length = 0;
}
