import { TAU } from '../core/utils.js';
import { colliders, enemies, pickups, refs, allies } from '../core/state.js';
import { SPAWNS, SNIPER_SPOTS, MAP_INFO } from '../world/map.js';
import { player } from '../entities/player.js';
import { uavActive } from '../systems/support.js';

/*
 * Top-down tactical map drawn from the real collision boxes. Used full-screen in play (Tab)
 * and as the briefing map. North (-Z) is up.
 */

let base = null, baseVersion = -1;
const SIZE = 600, WORLD = 96;
const toPx = (v) => ((v + WORLD / 2) / WORLD) * SIZE;

function buildBase() {
  baseVersion = MAP_INFO.version;
  base ||= document.createElement('canvas');
  base.width = base.height = SIZE;
  const c = base.getContext('2d');
  c.fillStyle = '#1a140f'; c.fillRect(0, 0, SIZE, SIZE);
  // sand texture speckle
  for (let k = 0; k < 2600; k++) { c.fillStyle = `rgba(220,180,120,${Math.random() * 0.05})`; c.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2); }
  c.strokeStyle = 'rgba(255,228,190,.07)'; c.lineWidth = 1;
  for (let v = -48; v <= 48; v += 8) { c.beginPath(); c.moveTo(toPx(v), 0); c.lineTo(toPx(v), SIZE); c.stroke(); c.beginPath(); c.moveTo(0, toPx(v)); c.lineTo(SIZE, toPx(v)); c.stroke(); }
  const sorted = colliders.slice().sort((a, b) => a.max.y - b.max.y);
  for (const b of sorted) {
    const h = b.max.y, x = toPx(b.min.x), y = toPx(b.min.z), w = toPx(b.max.x) - x, d = toPx(b.max.z) - y;
    const shade = h > 6.5 ? 0.62 : h > 3 ? 0.5 : h > 1.3 ? 0.4 : 0.3;
    c.fillStyle = `rgba(214,178,122,${shade})`;
    c.fillRect(x, y, w, d);
    c.strokeStyle = 'rgba(255,230,190,.35)'; c.strokeRect(x + 0.5, y + 0.5, w - 1, d - 1);
  }
  c.font = '600 15px Changa, sans-serif'; c.fillStyle = '#ffb36b'; c.textAlign = 'center';
  for (const l of MAP_INFO.labels) { c.save(); c.translate(toPx(l.x), toPx(l.z)); c.rotate(l.r); c.fillText(l.t, 0, 0); c.restore(); }
  c.fillStyle = 'rgba(255,90,74,.5)';
  for (const s of SPAWNS) { c.beginPath(); c.arc(toPx(s.x), toPx(s.z), 5, 0, TAU); c.fill(); }
  c.strokeStyle = 'rgba(255,210,74,.55)'; c.lineWidth = 2;
  for (const s of SNIPER_SPOTS) { c.beginPath(); c.arc(toPx(s.x), toPx(s.z), 9, 0, TAU); c.stroke(); }
}

/** Draws the map into `canvas`; with `live` it adds the player, ally, pickups and (under recon) raiders. */
export function drawTacMap(canvas, live) {
  if (!base || baseVersion !== MAP_INFO.version) buildBase();
  if (canvas.width !== SIZE) { canvas.width = canvas.height = SIZE; }
  const c = canvas.getContext('2d');
  c.drawImage(base, 0, 0);
  if (!live) return;
  for (const p of pickups) { c.fillStyle = p.kind === 'supply' ? '#7fe0a0' : '#9be38a'; c.fillRect(toPx(p.g.position.x) - 4, toPx(p.g.position.z) - 4, 8, 8); }
  const reveal = uavActive();
  for (const e of enemies) {
    if (!e.alive || (!reveal && e.spotted <= 0)) continue;
    c.fillStyle = e.static ? '#ffd24a' : '#ff5a4a';
    c.beginPath(); c.arc(toPx(e.pos.x), toPx(e.pos.z), 6, 0, TAU); c.fill();
  }
  if (refs.heli && refs.heli.state !== 'dead') { c.strokeStyle = '#ff5a4a'; c.lineWidth = 3; c.beginPath(); c.arc(toPx(refs.heli.pos.x), toPx(refs.heli.pos.z), 12, 0, TAU); c.stroke(); }
  for (const a of allies) if (a.alive) { c.fillStyle = '#7fe0a0'; c.beginPath(); c.arc(toPx(a.pos.x), toPx(a.pos.z), 6, 0, TAU); c.fill(); }
  const px = toPx(player.pos.x), pz = toPx(player.pos.z);
  c.save(); c.translate(px, pz); c.rotate(-player.yaw);
  c.fillStyle = '#ffb36b'; c.beginPath(); c.moveTo(0, -13); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill();
  c.restore();
}
