import * as THREE from 'three';
import { TAU, rand } from '../../core/utils.js';
import { solidMeshes } from '../../core/state.js';
import { MAT } from '../../assets/materials.js';
import { worldRoot, scaleUV } from '../builder.js';

/* Pieces every desert map shares: the sand floor and the dunes on the horizon. */

export function desertFloor() {
  const gg = new THREE.PlaneGeometry(260, 260, 1, 1);
  gg.rotateX(-Math.PI / 2);
  scaleUV(gg, 260 / 3.6, 260 / 3.6);
  const ground = new THREE.Mesh(gg, MAT.sand);
  ground.receiveShadow = true;
  ground.userData.surface = 'sand';
  worldRoot.add(ground);
  solidMeshes.push(ground);
}

/** Distant dunes (visual only). */
export function horizonDunes(n) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rand(-0.1, 0.1), d = rand(120, 190);
    const dune = new THREE.Mesh(new THREE.SphereGeometry(rand(30, 55), 18, 10), MAT.sand);
    dune.scale.y = rand(0.12, 0.22);
    dune.position.set(Math.cos(a) * d, -2, Math.sin(a) * d);
    dune.receiveShadow = true;
    worldRoot.add(dune);
  }
}
