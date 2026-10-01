/*
 * Shared registries and run state. Modules push into and read from these lists
 * instead of importing each other's internals.
 */

export const colliders = [];     // axis-aligned boxes: { min: Vector3, max: Vector3 }
export const solidMeshes = [];   // static meshes that bullets and sight lines test against

export const enemies = [];
export const ragdolls = [];
export const props = [];
export const debris = [];
export const pickups = [];
export const grenades = [];
export const parachutes = [];
export const aircraft = [];

export const allies = [];        // up to ALLY_MAX friendly soldiers
export const refs = { heli: null };

export const game = {
  state: 'boot',          // boot | splash | menu | playing | paused | dying | over
  mode: 'dusk',           // dusk | dawn
  diff: 'veteran',
  wave: 0, toSpawn: 0, spawnT: 0, maxAlive: 3,
  inter: 0, hour: 18.4, hourFrom: 16, hourTo: 16,
  waveTime: 0, heliDue: -1, snipersDue: [],
  storm: 0, stormTarget: 0, stormWave: -1,
  slowmo: 0,
  noLock: false,
};

export const run = {};
export function resetRun() {
  Object.assign(run, {
    score: 0, sp: 0, lines: {},
    kills: 0, hs: 0, shots: 0, hits: 0, streak: 0, bestStreak: 0, barrels: 0, barrelKills: 0,
    time: 0, lastKill: -9, multi: 0, dmgTaken: 0, waveDmg: 0, allyKills: 0, focusKills: 0,
    heliDowns: 0, supportsUsed: new Set(), medals: [], wavesCleared: 0, won: false,
  });
}
resetRun();
