import { enemies, refs, game } from '../core/state.js';
import { player } from '../entities/player.js';
import { music } from '../audio/music.js';
import { sfx } from '../audio/sfx.js';

/*
 * Battle tension. Watches the fight and drives the sound of it:
 *  - the score climbs as raiders close in, open fire, or the player gets hurt;
 *  - stingers mark the moments that matter: first contact (raiders closing in), an assault
 *    (a helicopter, a flanking move, an armoured push), raiders falling back, a last stand;
 *  - during a wave, a distant battle rumbles on the horizon.
 */

const T = { contact: 0, assault: 0, retreat: 0, streak: 0, lastStand: false };
const clock = () => performance.now() / 1000;
export function resetTension() { Object.assign(T, { contact: 0, assault: 0, retreat: 0, streak: 0, lastStand: false }); }

/** Something happened: 'assault' (heli, flank, heavy push), 'retreat' (raiders fall back), 'streak' (3+ kills). */
export function tensionEvent(name) {
  if (game.state !== 'playing') return;
  const t = clock();
  if (name === 'assault' && t > T.assault) { T.assault = t + 24; music.stinger('assault'); music.boost(0.35); }
  else if (name === 'retreat' && t > T.retreat) { T.retreat = t + 26; music.stinger('retreat'); }
  else if (name === 'streak' && t > T.streak) { T.streak = t + 8; music.stinger('streak'); }
}

export function updateTension(dt, inWave) {
  let near = Infinity, firing = 0, close = 0;
  for (const e of enemies) {
    if (!e.alive || e.rope) continue;
    const d = e.pos.distanceTo(player.pos);
    if (e.spotted > 0 || e.canSee) near = Math.min(near, d);
    if (e.canSee && e.target === player) firing++;
    if (d < 30) close++;
  }
  const t = clock();
  // raiders closing in: a hit on the drums and a riser that lifts the whole score
  if (inWave && near < 26 && t > T.contact) { T.contact = t + 30; music.stinger('contact'); music.boost(0.3); }
  if (player.alive && player.hp < 28 && !T.lastStand) { T.lastStand = true; music.stinger('laststand'); }
  else if (player.hp > 55) T.lastStand = false;
  music.setIntensity(inWave
    ? 0.22 + Math.min(close, 5) * 0.1 + Math.min(firing, 3) * 0.12 + (refs.heli ? 0.25 : 0) + (player.hp < 40 ? 0.2 : 0) + (player.suppress || 0) * 0.15
    : 0.1);
  if (inWave) sfx.distantBattle(dt);
}
