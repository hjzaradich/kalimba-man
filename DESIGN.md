# Kalimba Man — Design Decisions

A desktop trainer for kalimba: import a tab from kalimbatabs.net (or write your
own), and play along as numbered notes fall onto a picture of your instrument's
tines, Synthesia-style.

Status: pre-implementation. This document records decisions and their reasons
so they don't have to be re-litigated later. `ROADMAP.md` sequences the work.

---

## 1. Goals

1. Import a tab from kalimbatabs.net by URL, one song at a time.
2. Show it as falling notes, labeled with the number printed on the tine,
   landing on a rendering of the user's kalimba.
3. Work for any kalimba: ship presets (17-key, 21-key, Hluru 34-key, Chill Angels 46-key),
   and let users define their own layout including how accidentals are labeled.
4. Let users write and edit tabs in the site's text notation.
5. Songs are files. A friend can be sent a song and open it.
6. **Be shareable**: an installer a friend runs, on Windows first and macOS/Linux
   without a redesign. No prerequisites, no config editing.

Later goals, designed for but not built first: microphone note detection and
scoring; borrowing rhythm from an external MIDI file.

---

## 2. Core principles

### 2.1 One song model, many sources

Whether a song came from a MIDI file, pasted text, or the editor, the player
sees the same thing: a list of notes with an absolute pitch, a start time, and
a duration. Importers and editors produce that model; the renderer never knows
where a song came from.

### 2.2 Pitch is absolute; labels come from the layout

A note stores a MIDI pitch (C4 = 60). The number, dots, and sharp/flat that
appear on a falling note are looked up from the *layout* at render time, so the
same song shows `4#` on one kalimba and `5b` on another, and a tine's label
always matches the sticker on the instrument.

### 2.3 Timing is honest

A song knows whether its rhythm is real (from MIDI or user-recorded) or
inferred (uniform beats from text). Inferred songs are marked in the UI so a
learner is not misled into thinking the tab is metrically exact.

### 2.4 Files are the source of truth

Every song is one human-readable JSON file in the app's data folder. No
database. Deleting the folder resets the app; copying a file shares a song.

---

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | Same as `musicmanager`; small installers; builds Windows, macOS, Linux from one codebase |
| Backend | Rust | HTTP fetch with a browser user agent (bypasses CORS and Cloudflare's bot filter), MIDI parsing (own tolerant reader, see §6.1), HTML extraction (`scraper`), file I/O |
| Frontend | React + TypeScript + Vite | Familiar; UI chrome, editor, library |
| Note renderer | HTML `<canvas>` with `requestAnimationFrame` | Smooth scrolling of hundreds of notes; DOM would jank |
| Audio | Web Audio API in the frontend | Sine blip + reverb needs no native code; zero dependencies |
| Tests | vitest (parser, timing, layout math), Rust unit tests (fetch/MIDI) | Parser and timing are where bugs hide |

**Rejected:** Electron (size, no benefit here). Python/Tk (no smooth canvas
animation, packaging pain on macOS). A web-only app (the site's Cloudflare
protection blocks fetches from any browser origin other than its own, so the
import would not work without a server).

---

## 4. Data model

### 4.1 Layout

```ts
interface Layout {
  id: string;            // "chill-angels-46", "standard-17", or user-generated
  name: string;
  tuning: "C";           // tonic; numbers are scale degrees of this key
  accidentalStyle: "sharp" | "flat"; // default label style for new custom tines
  layers: LayerStyle[];  // color and optional horizontal shift per tier, index 0 = bottom
  tines: Tine[];
}

interface Tine {
  pitch: number;      // MIDI
  label: string;      // exactly what is printed on the tine: "1", "4#", "5b"
  octaveDots: number; // +1 = one dot above, -1 = one dot below (drawn, not typed)
  layer: number;      // tier: 0 = bottom, against the soundboard; higher tiers stack on top
  x: number;          // horizontal slot, 0..N-1 left to right as the player sees it
  length?: number;    // optional override of the drawn length, 0..1; derived from pitch when absent
}
```

Two tines may share a pitch (chromatic kalimbas duplicate some naturals on
upper tiers). When a note has several candidate tines, the lowest tier wins by
default; the editor can pin a note to a specific tine.

### 4.2 Song

```ts
interface Song {
  version: 1;
  title: string;
  artist?: string;
  source?: { url: string; fetchedAt: string; kind: "midi" | "text" };
  bpm: number;
  timeSignature: [number, number];
  timing: "measured" | "recorded" | "uniform"; // see 2.3
  notes: Note[];
  sections?: { time: number; label: string }[]; // "#A", lyric lines
  text?: string;   // the original notation, kept so the editor round-trips
}

interface Note {
  time: number;     // seconds from song start
  duration: number; // seconds
  pitch: number;    // MIDI
  chord?: number;   // notes with the same chord id were in one "( )" group
  tine?: number;    // optional pin to a specific tine index in the layout
}
```

Times are stored in seconds at the song's base BPM. The tempo slider scales
playback, never the file.

---

## 5. Notation parser

Input is the site's text notation. The parser is tolerant because posts are
hand-typed.

- Digits `1`–`7` are scale degrees of the song key, `1` = C4 when the key is C.
- `°` after a digit raises an octave; `°°` raises two. Also accept `'`, `.`,
  and `*` since other sites use them, and a leading `.` or `,` for a lowered
  octave.
- `#` or `b` directly before or after a digit is an accidental.
- Notes may be run together without spaces: `1°5°1°` is three notes;
  `5671°` is four.
- `( ... )` groups notes played together. They share a start time; the player
  draws them as one wide falling block spanning their tines.
- `~` after a note doubles its duration (site convention for long notes).
- `-` or `_` as a standalone token is a rest of one beat.
- A line containing no note tokens is a lyric or section line. `#A`-style
  markers become sections; other text becomes a section label so the player
  can show "Wise men say" above the bar it belongs to.
- Anything unparseable is kept as a warning with its line number, never
  silently dropped. The editor shows warnings inline.

Uniform timing: each note or chord is one beat at the song's BPM (default 100
for text imports); a line break inserts a half-beat rest. This is deliberately
simple; see §7 for how it gets better.

---

## 6. Importers

### 6.1 kalimbatabs.net, MIDI era (mid-2024 onward)

The page contains `kalimbaPlayerData = {"midiId":"KT_<base64>"}` where the
base64 decodes to the `.mid` URL. Fetch the page with a Chrome user-agent
string (Cloudflare returns 403 otherwise; the `.mid` itself is unprotected),
decode the URL, download the MIDI, and convert tracks to notes. Tempo comes
from the MIDI's tempo events. Title and artist come from the page's
`<title>` and the "Artist:" line. Timing is `measured`.

The site's MIDI files are slightly malformed (data bytes with the top bit
set). The `midly` crate rejects them in strict mode and silently truncates
them a third of the way through in lenient mode, so the app has its own
small Standard MIDI File reader (`src-tauri/src/smf.rs`) that masks data
bytes, honours running status, and keeps whatever a damaged track yielded.
It is tested against a saved file from the site.

### 6.2 kalimbatabs.net, text era (2019–2023, most popular songs)

No MIDI. Number notation sits in `<p>` blocks inside `.entry-content`,
interleaved with lyrics. Extract the paragraphs, run the parser, keep the
lyrics as sections. Timing is `uniform`.

### 6.3 Paste or type

The "Add song" screen always accepts raw text. This is the fallback if the
site changes or Cloudflare tightens, and it is also the editor.

### 6.4 Capability check

After import, compare the song's pitches with the selected layout. Report
which notes have no tine, and offer: transpose by N semitones, fold
out-of-range notes by an octave, or keep and show them as red "unplayable"
markers. Never silently alter pitches.

---

## 7. Rhythm for untimed songs

Ordered by cost. The first two ship in v1.

1. **Uniform beats** (§5). Always available.
2. **Tap to record.** Play the song in wait mode (§8) and the app records when
   each note was hit, quantizes to a sixteenth-note grid at the current BPM,
   and saves the result with `timing: "recorded"`. Spacebar or left click is
   the trigger until microphone detection exists.
3. **Borrow from an external MIDI** (later). Align the tab's pitch sequence to
   a user-supplied MIDI melody with dynamic time warping and copy the timing.
4. Aligning to the YouTube video is out of scope: heavy audio analysis and a
   legal grey area for a shareable app.

---

## 8. Player

- **Orientation:** notes fall from the top onto the tine board at the bottom,
  as the player sees the instrument. Each tine is a lane. Stacked tiers are
  drawn shorter as they go up and nudged sideways, with a distinct color per
  tier; falling notes take their tine's tier color so a glance says which
  tier to reach for.
- **Labels:** each falling note shows its tine's label and octave dots exactly
  as printed on the instrument.
- **Hit line** at the bridge, where every tier's tines are anchored, so it
  is one straight line across the board and timing between notes on
  different tiers reads directly. A note sounds as it crosses the line, then
  sinks through it. A note's block length is its duration. Chord members are
  tied by a bar across their leading edges.
- **Lookahead:** 4 seconds of upcoming notes visible at 1× speed; scales with
  tempo so the visual density stays constant.
- **Transport:** play/pause, seek bar, tempo slider (25%–150%, pitch
  unchanged because we synthesize), loop A/B markers, metronome toggle, wait
  mode toggle, hand hints toggle. All present in v1's UI; the ones not yet
  wired are disabled with a tooltip, so the layout is settled early.
- **Hand hints:** tines left of center are left thumb, right of center right
  thumb; a note shows an L or R tint on its edge. Free once tine x is known.
- **Wait mode:** playback pauses at each note (or chord) until spacebar or a
  click on the board, which also sounds it, then resumes. Recording is the
  same mechanism with playback off: each hit sounds the group, records the
  time, and jumps to the next; the taps are quantized to sixteenths at the
  song's BPM and saved as `timing: "recorded"`.

## 9. Audio

Web Audio: one oscillator per note (sine plus a quiet second harmonic for
body), fast attack, exponential decay tuned to the note's duration, into a
shared convolution reverb built from a synthetic impulse response. Scheduled
ahead of time from the same clock the renderer uses so audio and visuals stay
in sync. No sample files shipped.

## 10. Editor

A text editor over the song's `text` field with live parsing. Warnings appear
in a gutter; the right pane shows the parsed notes on the tine board as a
preview. Saving re-imports the text and keeps `timing` unless the user
recorded rhythm, in which case the recorded times are kept and the text is
regenerated from them. A timeline (piano-roll) editor is deferred.

## 11. Layouts and the custom-layout editor

Ship presets: `standard-17`, `standard-21`, `chill-angels-46` (see
`layouts/README.md` for the transcription and its verification status).

The custom editor starts from a preset or blank, then lets the user add a
layer, add tines with a pitch and a label, set each tine's slot and layer, and
choose sharp or flat labeling per tine or for the whole layout. Layouts are
JSON files in the data folder and are shareable like songs.

## 12. Files and folders

```
<platform app-data dir>/com.kalimbaman.desktop/
  songs/<slug>.kalimba.json
  layouts/<slug>.layout.json
  settings.json          # selected layout, last tempo, window size
```

On Windows that is `%APPDATA%\com.kalimbaman.desktop`, on macOS
`~/Library/Application Support/com.kalimbaman.desktop`, on Linux
`~/.local/share/com.kalimbaman.desktop`. The folder and its subfolders are
created on first launch.

`.kalimba.json` files can be opened by drag-and-drop or from the library's
Import button.

## 13. Distribution

- Tauri bundles: `.msi`/`.exe` for Windows, `.dmg` for macOS, `.AppImage`
  and `.deb` for Linux.
- GitHub Actions builds all three on every tag. macOS builds are blind (no
  Mac to test on regularly); the roadmap reserves time for borrowed-Mac
  sessions before each release that claims macOS support.
- Unsigned by default. Windows shows a SmartScreen warning; macOS requires
  right-click → Open the first time. The README explains both. Signing and
  notarization are a later decision that costs money, not design.
- Auto-update via the Tauri updater against a public releases repo
  (`hjzaradich/kalimba-man-releases`).
  `scripts/release.mjs` bumps, tags and pushes; the `release` job in CI
  builds, signs and publishes with `latest.json`. See `RELEASING.md`.
- WebView differs per OS (WebView2 on Windows, WKWebView on macOS). Canvas
  and Web Audio are well supported on both, but Web Audio on WKWebView
  needs a user gesture before the context starts. Start audio on the first
  Play click, never on load.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Cloudflare blocks the importer | Chrome UA today; paste fallback always present; importer isolated in one Rust module |
| 46-key layout transcribed wrong | Preset marked "draft" until verified against the instrument; layout editor fixes it in-app |
| Tab text is messier than sampled | Parser keeps warnings, never drops silently; add cases to the test corpus as found |
| Blind macOS builds break | CI builds every tag; smoke-test on a borrowed Mac before advertising Mac support |
| Audio/visual drift | One clock (`AudioContext.currentTime`) drives both |

## 15. Open questions

- Exact 46-key tine order per physical layer (see `layouts/README.md`).
- Whether the site's text tabs ever use `b` for flats or a lowered-octave
  mark; the parser accepts them but the corpus should confirm.
