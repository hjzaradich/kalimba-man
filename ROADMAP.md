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

## Phase 2 — Import from kalimbatabs.net and the song library — done

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

## Phase 3 — Practice tools — done

Goal: wire the transport controls that were placeholders.

- Loop A/B, metronome, hand hints (§8).
- Wait mode on spacebar or left click.
- Tap to record (§7.2) with quantization, saving `timing: "recorded"`.

Done when: an untimed song can be recorded in one pass and then plays back
with the recorded rhythm.

## Phase 4 — Custom layouts — done

Goal: any kalimba, any labeling.

- Layout editor (§11): layers, tines, pitch, label, sharp/flat style, slot.
- Import/export layout files; fix the 46-key preset from within the app and
  promote it from draft once verified.

Done when: a friend with a 21-key in a different tuning can define it and
play the same songs.

## Phase 5 — Release — done

- Installers for all three platforms from CI on a tag; README with the
  SmartScreen and Gatekeeper first-run notes.
- Updater and releases repo, reusing the `musicmanager` release script.
- One borrowed-Mac session to smoke-test before macOS is advertised.

Done when: a friend installs from a link and plays a song without help.

## Phase 6 — TheoryTab melodies — built

Goal: paste a hooktheory.com TheoryTab URL and get a kalimba tab with real
rhythm, fitted to your instrument.

- Rust: fetch the song page with a browser UA, extract section ids and
  names, fetch each section's Hookpad JSON from the public endpoint
  (DESIGN.md §6.4). Fixtures: one single-section and one multi-section song.
- Hookpad JSON → notes: key and mode to pitches, beats and tempo map to
  seconds, sections concatenated with markers, chords kept as an optional
  track. Handles per-voice note lists and rests. Tested against fixtures.
- Fitting (§6.5): a scorer that tries every transposition and octave and
  picks by the three-rule order, with tests on a 17-key and the 46-key.
- Add-song panel: a third tab "From TheoryTab" with the URL field, the
  section list with checkboxes (import all by default), a voice picker when
  the analysis has more than one, the chosen transposition with an override,
  and the usual save. Generated notation text so the song reads as a tab.
- "Copy tab as text" on any song, so a fitted melody can be shared as plain
  number notation.

Done when: "On Melancholy Hill" (one section, D major) and "Let It Be"
(three sections) import from their TheoryTab URLs, play with the right
rhythm, and land fully on the 46-key with no transposition while the 17-key
gets the smallest shift that fits.

## Phase 7 — Score mode, part 1: hearing the kalimba — in progress

Goal: switch to score mode, pluck the real instrument, and the matching
tines light up on the board (DESIGN.md §16).

1. Spike: microphone → worklet pump → level meter in the transport bar.
   Proves the WebView2 permission prompt, worklet loading under Vite and
   Tauri, and the shared AudioContext. Adds a "Save clip" control (20 s
   to WAV in the data folder's `recordings`) so fixtures come through the
   real mic path. — built; the permission prompt inside Tauri and the
   meter on a live mic are still to be seen on a real machine.
2. Detector as a pure module (§16.5) with synthetic-signal tests: single
   notes, chords, an arpeggio over a ringing note, the bass row, quick
   repeats, a metronome click, silence. — built, ten scenes pass.
3. Mute button in the transport bar, saved in settings; the score-mode
   toggle, exclusive with wait and record, which switches mute on and
   restores it on exit. Hits light tines on the board in their own
   colour. — built. Still to do: record the real-instrument fixtures and
   tune thresholds against them.
4. Microphone picker with the saved device and the missing-device
   fallback; tuning offset; sensitivity; the tolerant `mic` settings
   block. — the listener supports a device id and fallback; no UI yet.

Done when: on the 46-key, the fan, the bass row, the sharps tier and a
chord each light the right tines, nothing lights during silence or from
the metronome, the song is silent in score mode unless unmuted, and the
fixtures pass in CI.

## Phase 8 — Tuner mode — later

Reads the ringing note's pitch continuously from the same detector and
shows the cents on a needle; a pass through the instrument records
per-tine offsets and spectra for detection (§16.6).

## Phase 9 — Score mode, part 2: grading — later

Hits matched to notes within timing windows, per-note feedback on the
falling notes, running score and end-of-song summary (§16.9).

## Later

- Play TheoryTab chords as accompaniment (glissandi on the beat).
- TheoryTab search from inside the app instead of pasting a URL.
- Borrow rhythm from an external MIDI by sequence alignment (§7.3).
- Timeline editor.
- Code signing and notarization if the warnings turn friends away.
