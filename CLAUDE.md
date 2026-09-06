# Notes for Claude Code

Read `DESIGN.md` first: it holds the architecture and the reasoning.
`ROADMAP.md` says what is built and what comes next. This file covers what is
easy to break.

## What this is

A desktop kalimba trainer. Tauri 2 + Rust backend + React/TypeScript
frontend. Songs fall as numbered notes onto a canvas drawing of the user's
kalimba. Meant to be handed to friends as an installer, so: no system
dependencies, nothing hardcoded to one machine, macOS and Linux builds must
keep compiling even though they are only tested occasionally.

## Invariants

**Pitch is absolute, labels come from the layout.** A note stores a MIDI
pitch. What is drawn on it is looked up from the selected layout's tine.
Never derive a label from a scale degree in the renderer.

**Layout presets are generated.** Edit `scripts/gen-layouts.mjs`, run
`npm run gen:layouts`, review the diff. Do not hand-edit the JSON in
`layouts/`; the tests in `src/presets.test.ts` check the files against the
generator's conventions and will catch drift.

**`chill-angels-46` is a draft.** It has not been checked against the real
instrument (`layouts/README.md` lists what is unverified). Keep
`"draft": true` until the user confirms it.

**Tier 0 is the bottom tier and is drawn first.** Tiers stacked on top are
painted later and shorter (`src/board/geometry.ts`), so every tip stays
visible. On the 46-key that order is bass, main fan, sharps. Reversing it
hides tips and labels.

**Settings are tolerant.** `settings.json` loads with defaults for missing
fields and ignores unknown ones; corrupt JSON falls back to defaults rather
than failing startup. Keep it that way when adding fields.

## Running

```
npm run tauri dev      # native window
npm run dev            # frontend only, in a browser, settings in localStorage
npm test               # vitest
cd src-tauri && cargo test
```

The frontend detects Tauri via `__TAURI_INTERNALS__` and otherwise falls
back to browser behaviour, so UI work can be previewed and screenshotted
without the native window. Rust commands only exist inside Tauri.

## Layout of the code

- `src/model/layout.ts` — layout types and label/pitch conventions.
- `src/board/geometry.ts` — pure tine geometry (tested). `drawBoard.ts` paints it.
- `src/presets.ts` — the shipped layouts, imported from `layouts/*.layout.json`.
- `src/settings.ts` — settings via Tauri commands or localStorage.
- `src-tauri/src/lib.rs` — data folder, settings commands.
