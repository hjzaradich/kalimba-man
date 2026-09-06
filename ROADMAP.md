# Roadmap

Each phase ends with something you can run and judge. Decisions behind the
phases are in `DESIGN.md`; section numbers below refer to it.

## Phase 0 — Scaffold and tine board — done

Goal: a window that draws your kalimba.

- Tauri 2 + React/TS/Vite project, vitest, Rust tests, CI that builds on
  Windows, macOS and Linux from day one (so blind Mac builds are checked on
  every push, not at release time).
- Layout model (§4.1) and the three presets as JSON. `chill-angels-46` ships
  as a draft per `layouts/README.md`.
- Canvas tine board: layers drawn with depth, labels and octave dots as
  printed, one color per layer. Layout picker in settings.
- Data folder created on first run (§12).

Done when: the 46-key board on screen looks like the diagram and switching to
17-key redraws correctly.

## Phase 1 — Play along to pasted text — done

Goal: paste a tab from the site, press Play, play along.

- Notation parser (§5) with a test corpus taken from real posts, including
  run-together notes, chords, lyrics lines and `#A` markers.
- Song model (§4.2), uniform timing, JSON save/load.
- Falling-note renderer: lanes, hit line, lookahead, chord blocks, labels
  from the layout, layer colors.
- Web Audio synth (§9) and a single clock driving audio and canvas.
- Transport bar with every control from §8 present. Play/pause, seek and
  tempo work; the rest are disabled with tooltips.
- Capability check (§6.4) with transpose and octave-fold options.

Done when: "Can't Help Falling in Love" pasted from the site plays through
with notes landing on the right tines and the blip sounding on time.

## Phase 2 — Import from kalimbatabs.net and the song library — built

Goal: the "Add song" screen.

- Rust fetch with browser UA; MIDI-era importer (§6.1) on our own tolerant
  MIDI reader; text-era importer (§6.2); clear error when neither applies.
- Add-song screen: URL field, or paste/type text; preview on the board;
  title/artist/BPM fields; save to library.
- Library screen: list, search, open, delete (with confirm), import a
  `.kalimba.json` file, drag-and-drop, reveal in folder.
- Text editor (§10) for existing songs with inline warnings.

Done when: "On Melancholy Hill" imports by URL with real timing and shows
`measured`; "River Flows in You" imports by URL as `uniform`; a song file
copied to another machine opens there.

## Phase 3 — Practice tools

Goal: wire the transport controls that were placeholders.

- Loop A/B, metronome, hand hints (§8).
- Wait mode on spacebar or left click.
- Tap to record (§7.2) with quantization, saving `timing: "recorded"`.

Done when: an untimed song can be recorded in one pass and then plays back
with the recorded rhythm.

## Phase 4 — Custom layouts

Goal: any kalimba, any labeling.

- Layout editor (§11): layers, tines, pitch, label, sharp/flat style, slot.
- Import/export layout files; fix the 46-key preset from within the app and
  promote it from draft once verified.

Done when: a friend with a 21-key in a different tuning can define it and
play the same songs.

## Phase 5 — Release

- Installers for all three platforms from CI on a tag; README with the
  SmartScreen and Gatekeeper first-run notes.
- Updater and releases repo, reusing the `musicmanager` release script.
- One borrowed-Mac session to smoke-test before macOS is advertised.

Done when: a friend installs from a link and plays a song without help.

## Later

- Microphone note detection and scoring (guitar-hero grading).
- Borrow rhythm from an external MIDI by sequence alignment (§7.3).
- Timeline editor.
- Code signing and notarization if the warnings turn friends away.
