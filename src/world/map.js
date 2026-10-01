import * as THREE from 'three';
import { scene } from '../core/renderer.js';
import { world, buildStaticPhysics } from '../core/physics.js';
import { colliders, solidMeshes } from '../core/state.js';
import { worldRoot, resetBuilder, mergeDeco } from './builder.js';
import { buildNav } from './nav.js';
import { resetProps } from './props.js';
import { rebuildAmbient } from './ambient.js';
import citadel from './maps/citadel.js';
import village from './maps/village.js';
import station from './maps/station.js';

/*
 * The current map. Every map lives in ./maps/ as a plain description (spawns, sniper nests,
 * zones, props, menu backdrop) plus a build() that places its geometry under worldRoot.
 * The arrays and objects exported here are filled in place by loadMap(), so the rest of the
 * game reads them without caring which map is loaded.
 */

export const MAP_DEFS = { citadel, village, station };

export const SPAWNS = [];
export const HOVER_POINTS = [];
export const SNIPER_SPOTS = [];
export const FLAG_SPOTS = [];
export const PLAYER_START = new THREE.Vector3();
export const MAP_INFO = {
  id: '', name: '', startYaw: 0,
  interior: () => true,
  dropFallback: new THREE.Vector3(),
  zones: [], zoneFallback: '', labels: [], props: {}, showcase: null,
  birds: new THREE.Vector3(0, 27, 0),
  version: 0,
};

let staticBodies = [];

function unloadWorld() {
  worldRoot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  worldRoot.clear();
  colliders.length = 0;
  solidMeshes.length = 0;
  resetBuilder();
  for (const b of staticBodies) world.removeBody(b);
  staticBodies = [];
}

/** Build map `id` (unless it is already loaded). Returns true when the world changed. */
export function loadMap(id) {
  const def = MAP_DEFS[id] || citadel;
  if (MAP_INFO.id === def.id) return false;
  if (!worldRoot.parent) scene.add(worldRoot);
  unloadWorld();

  const v3 = ([x, y, z]) => new THREE.Vector3(x, y, z);
  SPAWNS.length = 0; SPAWNS.push(...def.spawns.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  HOVER_POINTS.length = 0; HOVER_POINTS.push(...def.hover.map(([x, z]) => new THREE.Vector3(x, 17, z)));
  SNIPER_SPOTS.length = 0; SNIPER_SPOTS.push(...def.snipers.map(v3));
  FLAG_SPOTS.length = 0;
  PLAYER_START.set(def.start[0], 0, def.start[1]);
  Object.assign(MAP_INFO, {
    id: def.id, name: def.name, startYaw: def.startYaw || 0,
    interior: def.interior,
    dropFallback: new THREE.Vector3(def.dropFallback[0], 0, def.dropFallback[1]),
    zones: def.zones, zoneFallback: def.zoneFallback, labels: def.labels, props: def.props, showcase: def.showcase,
    birds: v3(def.birds),
    version: MAP_INFO.version + 1,
  });

  def.build({ flags: FLAG_SPOTS });
  mergeDeco();
  buildNav();
  staticBodies = buildStaticPhysics(colliders);
  resetProps();
  rebuildAmbient();
  return true;
}
