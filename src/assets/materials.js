import * as THREE from 'three';
import { TEX } from './textures.js';

/* Shared world materials. buildMaterials() runs once, after buildTextures(). */

export const std = (o) => new THREE.MeshStandardMaterial(o);
export const MAT = {};

export function buildMaterials() {
  Object.assign(MAT, {
    sand: std({ map: TEX.sand, normalMap: TEX.sandN, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) }),
    plaster: std({ map: TEX.plaster, normalMap: TEX.plasterN, roughness: 0.93 }),
    plasterWarm: std({ map: TEX.plaster, normalMap: TEX.plasterN, roughness: 0.93, color: 0xf0d8c0 }),
    stone: std({ map: TEX.stone, normalMap: TEX.stoneN, roughness: 0.86 }),
    rock: std({ map: TEX.stone, normalMap: TEX.stoneN, roughness: 0.95, color: 0xb59a78, flatShading: true }),
    crate: std({ map: TEX.crate, normalMap: TEX.crateN, roughness: 0.82 }),
    planks: std({ map: TEX.planks, roughness: 0.85 }),
    beam: std({ map: TEX.planks, roughness: 0.9, color: 0x9a8070 }),
    metal: std({ color: 0x3b3c3e, metalness: 0.75, roughness: 0.42 }),
    darkMetal: std({ color: 0x1f2022, metalness: 0.8, roughness: 0.35 }),
    barrelRed: std({ map: TEX.barrelRed, metalness: 0.45, roughness: 0.5 }),
    barrelOlive: std({ map: TEX.barrelOlive, metalness: 0.45, roughness: 0.55 }),
    barrelBlue: std({ map: TEX.barrelBlue, metalness: 0.45, roughness: 0.55 }),
    windowDark: std({ color: 0x17120e, roughness: 0.35, metalness: 0.2 }),
    windowGlow: std({ color: 0x21160c, emissive: 0xff9c45, emissiveIntensity: 0, roughness: 0.5 }),
    lantern: std({ color: 0x3a2412, emissive: 0xffb45a, emissiveIntensity: 0, roughness: 0.4 }),
    cloth: std({ map: TEX.cloth, side: THREE.DoubleSide, roughness: 0.95 }),
    sandbag: std({ map: TEX.webbing, color: 0xb49a6c, roughness: 1 }),
    trunk: std({ map: TEX.plaster, normalMap: TEX.stoneN, color: 0x7a5a3c, roughness: 1 }),
    leaf: std({ map: TEX.leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 }),
    water: std({ color: 0x2d4a52, roughness: 0.06, metalness: 0.3, normalMap: TEX.waterN, normalScale: new THREE.Vector2(0.35, 0.35) }),
    brass: std({ color: 0xd4a95a, metalness: 1, roughness: 0.28 }),
    flag: std({ map: TEX.flag, side: THREE.DoubleSide, roughness: 0.9 }),
    canopy: std({ map: TEX.canopy, side: THREE.DoubleSide, roughness: 0.85 }),
    canopyCargo: std({ map: TEX.canopyCargo, side: THREE.DoubleSide, roughness: 0.8 }),
    supplySide: std({ map: TEX.supplySide, roughness: 0.75, metalness: 0.15 }),
    supplyShell: std({ color: 0x4d5433, roughness: 0.75, metalness: 0.15 }),
    strap: std({ color: 0xd86a1e, roughness: 0.9 }),
    pallet: std({ map: TEX.planks, color: 0xb8a58a, roughness: 0.95 }),
    // village
    mud: std({ map: TEX.plaster, normalMap: TEX.plasterN, color: 0xc9a27a, roughness: 1 }),
    burnt: std({ map: TEX.stone, color: 0x4a3426, roughness: 0.85, metalness: 0.4 }),
    charred: std({ map: TEX.planks, color: 0x5a4636, roughness: 0.95 }),
    iron: std({ color: 0x5b4a3e, metalness: 0.6, roughness: 0.55 }),
    embers: std({ color: 0x2a1208, emissive: 0xff5a1a, emissiveIntensity: 0.15, roughness: 0.9 }),
    banner: std({ map: TEX.enemyBanner, side: THREE.DoubleSide, roughness: 0.92 }),
    clay: std({ map: TEX.plaster, color: 0xc0724a, roughness: 0.9 }),
    concrete: std({ map: TEX.sand, normalMap: TEX.plasterN, normalScale: new THREE.Vector2(0.35, 0.35), color: 0xd8d2c6, roughness: 0.95 }),
    canvas: std({ map: TEX.webbing, color: 0x7a7556, roughness: 1, side: THREE.DoubleSide }),
    carpet: std({ map: TEX.cloth, color: 0xb86a5a, roughness: 1, side: THREE.DoubleSide }),
    shrub: std({ map: TEX.leaf, color: 0x9aa070, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }),
    steel: std({ color: 0x6d6a66, metalness: 0.8, roughness: 0.45 }),
    wagon: std({ map: TEX.panels, color: 0x8a4632, metalness: 0.35, roughness: 0.7 }),
    tank: std({ map: TEX.panels, color: 0xd8d2c4, metalness: 0.35, roughness: 0.55 }),
    cable: new THREE.LineBasicMaterial({ color: 0x2a2622 }),
    rust: std({ map: TEX.stone, color: 0x8a4a28, roughness: 0.8, metalness: 0.5 }),
    dome: std({ map: TEX.plaster, color: 0x86b4ab, roughness: 0.55 }),
    // aircraft
    hullGrey: std({ map: TEX.panels, color: 0x8d8b80, metalness: 0.35, roughness: 0.6 }),
    hullDark: std({ map: TEX.panels, color: 0x4a5048, metalness: 0.4, roughness: 0.55 }),
    hullJet: std({ map: TEX.panels, color: 0x9aa0a6, metalness: 0.5, roughness: 0.45 }),
    glass: std({ color: 0x10161c, metalness: 0.9, roughness: 0.08 }),
    rubber: std({ color: 0x151515, roughness: 0.9 }),
    navRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }),
    navGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.6) }),
    navWhite: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }),
    engineGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.8) }),
  });
}
