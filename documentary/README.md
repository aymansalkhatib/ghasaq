# Ghasaq documentary

A tool that makes a documentary about the game from the game itself. It runs the game in headless Chromium, captures it frame by frame, generates its own soundtrack in sync with the picture, and cuts the scenes into one 1920×1080 film.

The tool does not modify anything in `src/`. Everything is injected at run time. The on-screen titles and captions in the film are in Arabic, like the game.

## Running it

You need **Node.js 18+**, **ffmpeg** on your `PATH`, and **Playwright** with Chromium, then `npm install` in the project root.

```bash
node documentary/server.mjs                     # game server for recording on port 4176 (leave it running)
DOC_DRY=1 node documentary/record.mjs A B C     # quick trial: one image every 2 seconds in documentary/out-dry/
node documentary/record.mjs A B C D E F G       # the real recording, into documentary/out/<scene>/
node documentary/edit.mjs                       # edit: documentary/ghasaq-documentary.mp4
node documentary/edit.mjs draft.mp4 --draft     # fast 960×540 draft for review
```

- Record the scenes **in order**. The player's progress (experience, rank, medals) carries from one scene to the next through `out/state.json`, and the after-action report in scene G shows the totals.
- On a machine without a GPU (software rendering with SwiftShader) a frame takes about a second, which is roughly 30 minutes of rendering per minute of film.
- Do not edit `director.js` while recording: each scene loads its own copy when it starts.

## Files

| File | Purpose |
| --- | --- |
| `server.mjs` | Vite server for the game: fonts bundled (no network needed) and no hot reload, so a take is never interrupted. |
| `shim.js` | Injected before any game code. A virtual clock for `requestAnimationFrame`, timers, `performance.now`, `Date` and CSS animations. `AudioContext` is replaced by an `OfflineAudioContext` that follows the same clock, so the whole soundtrack is rendered at the end. `Math.random` is seeded. |
| `director.js` | The "director". It imports the game's own modules and contains an autopilot that aims, fires and moves, a cinematic camera for the aerial shots, an Arabic layer for titles and captions, a mouse pointer for the menus, and the seven scenes. |
| `record.mjs` | Opens a browser per scene, steps the clock 1/30 s at a time and pipes every frame to ffmpeg. At the end it renders the audio and trims it to the picture. |
| `edit.mjs` | Joins the scenes with crossfades, levels each scene's sound and then the whole film to −16 LUFS, and scales the picture to 1080p. |
| `film-page/` | A small download page for the finished film (Arabic interface). The video files themselves stay out of git. |

## Scenes

| Scene | Content |
| --- | --- |
| A | Title, splash screen, menu, briefing (the three maps and difficulty), loadout, then chapter one, "The first hour" (16:00) |
| B | Chapter two, "Support", at sunset: recon, the supply crate by parachute and the marksman rifle, the ally, focus |
| C | Chapter three, "When night falls": the weapon light, raiders' laser sights, bringing down the helicopter, the airstrike |
| D | Chapter four, "Other grounds": the abandoned village from the air, then a fight in a sandstorm |
| E | Valley Station at sunset: an aerial shot, then a crane shot toward the clock tower |
| F | Chapter five, "Made from code": a whole day in seconds, the soldiers, the air fleet, a card with the numbers |
| G | Chapter six, "Midnight": the last wave, victory, the after-action report, the closing card |

## Disclosure

The play in the film is by an **autopilot**, with some help for filming:

- Damage to the player is 30%, and health never drops below 58.
- Allies are tougher, and bullet damage to the helicopter is doubled.
- Extra raiders are added to every fight so the arena never empties, and support points are granted in advance.
- The supply crate always carries the marksman rifle.

The closing card says so openly.
