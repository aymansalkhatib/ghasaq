import { MAP_INFO } from './map.js';

/*
 * Named areas of the current map, used for the HUD location readout and for the raiders'
 * intercepted radio callouts. Each map lists its zones as rectangles; the first match wins.
 */

export function zoneAt(x, z) {
  for (const a of MAP_INFO.zones) if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return a.name;
  return MAP_INFO.zoneFallback;
}
