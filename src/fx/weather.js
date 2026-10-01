import { clamp, damp } from '../core/utils.js';
import { camera } from '../core/renderer.js';
import { tod } from '../core/sky.js';
import { game } from '../core/state.js';
import { fx } from './particles.js';
import { sfx } from '../audio/sfx.js';

/*
 * Sandstorm: fog thickens and turns ochre, dust streams across the screen and the wind howls.
 * It limits sight for both sides; raiders get wider spread and shorter sight range while it blows.
 */

export function setStorm(on) { game.stormTarget = on ? 1 : 0; }

export function updateWeather(dt) {
  const target = game.stormTarget || 0;
  game.storm += (target - game.storm) * damp(target > game.storm ? 0.35 : 0.5, dt);
  if (game.storm < 0.002) game.storm = 0;
  tod.storm = clamp(game.storm, 0, 1);
  if (tod.storm > 0.02) fx.storm(camera.position, tod.storm, dt);
  sfx.setStorm(tod.storm);
}
