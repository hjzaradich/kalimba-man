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
`"draft": true` until the user confirms it. The user can copy it in the
kalimba manager, fix it, and tick "checked against the instrument"; fold
those fixes back into `scripts/gen-layouts.mjs` when they arrive.

**User layouts are files with slugs that never collide with preset ids**
(`freeLayoutSlug`). `settings.layoutId` may name either; the App resolves
presets first, then the loaded user layout, then falls back to the default.

**Tier 0 is the bottom tier and is drawn first.** Tiers stacked on top are
painted later and shorter (`src/board/geometry.ts`), so every tip stays
visible. On the 46-key that order is bass, main fan, sharps. Reversing it
hides tips and labels.

**Never commit the signing key.** `~/.tauri/kalimba-man.key` signs updates;
its public half is in `tauri.conf.json`. `.gitignore` blocks `*.key`, keep
it that way. Releases go through `scripts/release.mjs` and CI, never by
hand-uploading files under an existing tag (`RELEASING.md`).

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

**Wait mode and recording mute the scheduler.** In those modes the user's
hit sounds the notes (`practice.ts`); the scheduler must not also play them.
`Practice` flags its own transport calls as internal so a manual seek is
told apart from its own pauses and jumps.

**TheoryTab is an undocumented endpoint.** `theorytab.rs` reads section ids
from the page and each section's Hookpad JSON from
`api.hooktheory.com/v1/songs/public/<id>`; nobody promised us that. Keep the
fixtures and let a format change fail the tests. Conversion lives in the
frontend so the Rust side stays a fetcher.

**Fits are recorded, never baked in.** `refitSong` always starts from
`song.original` (or the notes themselves when there is no record) and writes
both the fitted notes and the record. Do not transpose or fold a song's notes
in place anywhere else; the user must be able to undo it or redo it for a
different kalimba (`restoreOriginal`, `fittedElsewhere`).

**Tine clicks hit-test the layout, never a cached frame.** `PlayerCanvas`
recomputes the board geometry from the current layout and canvas size on
every pointer-down (`playerTineAt`) and hands the `Tine` itself to `onTine`,
so a click straight after a layout change cannot resolve against an older
layout or a frame that failed to draw. Sounding a tine goes through
`soundPitch`, which waits for a suspended or interrupted AudioContext to
resume before plucking (WebKit parks the context after idle time). Do not
reintroduce an index-into-the-last-drawn-geometry path.

**The parser never drops input silently.** Anything `notation.ts` cannot read
becomes a warning with a line and column. Add a test case with the real
text whenever a site post trips it.

## Layout of the code

- `src/model/layout.ts` — layout types and label/pitch conventions.
- `src/model/notation.ts` — number-notation parser (tested against real posts).
- `src/model/song.ts` — song model, uniform timing, JSON coercion.
- `src/model/capability.ts` — can this kalimba play this song; transpose/fold fixes.
- `src/model/recording.ts` — hit groups and tap-to-record re-timing (pure, tested).
- `src/model/layoutEdit.ts` — pure editing operations on layouts (fills, tiers, tines); `src/model/pitch.ts` — note names.
- `src/layouts.ts` — user layout files (Tauri or localStorage) and `coerceLayout`; `src/LayoutPanel.tsx` — the kalimba manager and editor; `src/board/hitTest.ts` — click → tine (pure, tested; the player uses `playerTineAt`).
- `src/board/geometry.ts` — pure tine geometry (tested). `drawBoard.ts` paints it; `labels.ts` draws printed labels.
- `src/player/` — `transport.ts` (clock), `synth.ts` (Web Audio voice), `scheduler.ts` (hands notes to the synth ahead of time), `noteLayout.ts` (note → tine), `drawPlayer.ts` (one frame), `PlayerCanvas.tsx` (rAF loop), `practice.ts` (wait mode and recording on top of the transport), `TransportBar.tsx`.
- `src/presets.ts` — the shipped layouts, imported from `layouts/*.layout.json`.
- `src/settings.ts`, `src/songs.ts` — persistence via Tauri commands or localStorage.
- `src/importer.ts` — turns Rust import results (kalimbatabs, TheoryTab) into Songs; `src/model/notationOut.ts` writes notes back as text.
- `src/model/hookpad.ts` — Hookpad JSON (TheoryTab) → notes and chords; `src/model/fit.ts` — the transposition/fold fitter (DESIGN.md §6.5). Both tested on saved TheoryTab sections.
- `src/AddSongPanel.tsx` — URL import, paste, and the text editor (with `existing`); `src/LibraryPanel.tsx` — the song list.
- `src-tauri/src/lib.rs` — data folder, settings, song file commands, import command.
- `src-tauri/src/import.rs` — page fetch and extraction for both eras of posts, MIDI → notes; `smf.rs` — the tolerant MIDI reader; `theorytab.rs` — TheoryTab page and section fetch. Fixtures in `src-tauri/fixtures/`.

**Score mode hears through one file.** `src/mic/listener.ts` is the only
file that touches the capture API. `pump.worklet.js` stays plain
JavaScript and must be emitted as a real asset (`vite.config.ts` stops
Vite inlining it; a data: URL is not a worklet module everywhere). The
detector (`src/mic/detector.ts`) is pure: arrays in, hits out, tested with
synthetic plucks in `testSignals.ts` and, once recorded, WAV fixtures
from the instrument. Hit times are AudioContext seconds, the transport's
clock; never stamp them from `performance.now()`. Score mode is exclusive
with wait and record, and switches Mute on; the metronome is not part of
Mute because the detector rejects its click.
