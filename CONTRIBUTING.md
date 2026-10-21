# Contributing to Ghasaq

Thank you for your interest in contributing to **Ghasaq**!

Ghasaq is a procedural, Arabic-language survival shooter built with Three.js, cannon-es, and Vite. We welcome contributions that maintain the project's lean architecture, zero-external-asset design philosophy, and authentic Arabic RTL presentation.

---

## Architecture Overview

The codebase is organized into modular JavaScript ES modules:

| Directory | Purpose | Key Files |
|---|---|---|
| `src/config/` | Numerical game balance and defaults | `balance.js`, `settings.js` |
| `src/world/` | World generation, collision, and maps | `map.js`, `maps/citadel.js`, `maps/village.js`, `maps/station.js` |
| `src/entities/` | Player, AI raiders, allies, and ragdolls | `player.js`, `enemy.js`, `ally.js`, `soldier-model.js` |
| `src/weapons/` | Weapon logic, first-person viewmodels, grenades | `arsenal.js`, `viewmodels.js`, `grenades.js` |
| `src/vehicles/` | Aircraft, helicopter, parachutes, drops | `helicopter.js`, `models.js` |
| `src/systems/` | Wave logic, air support, progression | `waves.js`, `support.js`, `progression.js` |
| `src/audio/` | Web Audio API procedural synthesis | `engine.js`, `sfx.js`, `music.js` |
| `src/ui/` | Arabic RTL HUD, screens, and menus | `hud.js`, `screens.js`, `armory.js` |

---

## Key Contribution Areas

### 1. Adding or Modifying Maps
Each battlefield is self-contained in `src/world/maps/`:
- To create a new map, add a new file in `src/world/maps/` (e.g. `outpost.js`) following the pattern of existing maps.
- Register your map in `MAP_DEFS` inside `src/world/map.js`.
- Add the map entry and Arabic description to `MAPS` in `src/config/balance.js`.

### 2. Tuning Game Balance
Weapon damage, rate of fire, raider AI difficulty curves, and wave pacing are declared in `src/config/balance.js`. Tweak values here without altering entity logic.

### 3. Procedural Assets (No External Media)
A core tenet of Ghasaq is that **no external image, audio, or 3D model files exist in the repository**:
- Textures are generated on HTML5 canvas elements (`src/assets/textures.js`).
- Models are constructed from Three.js geometric primitives (`src/entities/soldier-model.js`, `src/vehicles/models.js`).
- Sound effects and music are synthesised via the Web Audio API (`src/audio/`).
Please preserve this zero-asset constraint when adding features.

---

## Development Workflow

1. Fork the repository and create a feature branch:
   ```bash
   git checkout -b feature/my-improvement
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Build the project to verify that the build succeeds cleanly:
   ```bash
   npm run build
   ```
5. Open a Pull Request describing your changes, with a screenshot or brief clip if applicable.
