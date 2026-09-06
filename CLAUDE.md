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

**One clock.** `src/player/transport.ts` is the only source of song time.
The canvas reads it every frame and the scheduler converts note times to
AudioContext times through it. Do not add a second timer for anything that
must line up with the notes.

**Audio starts on a user gesture.** The AudioContext and synth are created
in the first Play click (`ensureAudio` in `App.tsx`), never on load: WKWebView
refuses audio otherwise.

**Use our own MIDI reader, not a crate.** The site's MIDI files have data
bytes with the top bit set; `midly` truncated them silently. `smf.rs` is
tested against a real file from the site; keep that fixture.

**The parser never drops input silently.** Anything `notation.ts` cannot read
becomes a warning with a line and column. Add a test case with the real
text whenever a site post trips it.

## Layout of the code

- `src/model/layout.ts` — layout types and label/pitch conventions.
- `src/model/notation.ts` — number-notation parser (tested against real posts).
- `src/model/song.ts` — song model, uniform timing, JSON coercion.
- `src/model/capability.ts` — can this kalimba play this song; transpose/fold fixes.
- `src/board/geometry.ts` — pure tine geometry (tested). `drawBoard.ts` paints it; `labels.ts` draws printed labels.
- `src/player/` — `transport.ts` (clock), `synth.ts` (Web Audio voice), `scheduler.ts` (hands notes to the synth ahead of time), `noteLayout.ts` (note → tine), `drawPlayer.ts` (one frame), `PlayerCanvas.tsx` (rAF loop), `TransportBar.tsx`.
- `src/presets.ts` — the shipped layouts, imported from `layouts/*.layout.json`.
- `src/settings.ts`, `src/songs.ts` — persistence via Tauri commands or localStorage.
- `src/importer.ts` — turns the Rust import result into a Song; `src/model/notationOut.ts` writes notes back as text.
- `src/AddSongPanel.tsx` — URL import, paste, and the text editor (with `existing`); `src/LibraryPanel.tsx` — the song list.
- `src-tauri/src/lib.rs` — data folder, settings, song file commands, import command.
- `src-tauri/src/import.rs` — page fetch and extraction for both eras of posts, MIDI → notes; `smf.rs` — the tolerant MIDI reader. Fixtures in `src-tauri/fixtures/`.
