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
  source?: { url: string; fetchedAt: string; kind: "midi" | "text" | "theorytab" };
  chords?: Chord[];   // optional accompaniment from TheoryTab: { time, duration, pitches }
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

### 6.3 MIDI files

Any `.mid` file, picked in the Add-song panel or dropped on the window,
goes through the same reader as the site's MIDI. Files with several tracks
get a track picker; the fullest track is chosen first, since accompaniment
tracks are not what a kalimba plays. Timing is `measured`, the title comes
from the file name, and a drop is fitted automatically with the fit
recorded (§6.5).

### 6.3a Paste or type

The "Add song" screen always accepts raw text. This is the fallback if the
site changes or Cloudflare tightens, and it is also the editor.

### 6.4 TheoryTab (hooktheory.com)

TheoryTab analyses hold what the text era of kalimbatabs lacks: melody as
scale degrees with rhythm in beats, plus chords, in a stated key and mode.
There is no official API for them, but the site's own player reads each
section from a public, unauthenticated endpoint:

```
GET https://api.hooktheory.com/v1/songs/public/<sectionId>?fields=ID,xmlData,song,jsonData
```

The section ids are in the song page's HTML (`shToPendingTheoryTabs("tab-<id>", …)`,
one per section, in page order) and the section names are the page's tab
labels. `jsonData` is a Hookpad document (`version`, `keys`, `tempos`,
`meters`, `notes`, `chords`, `endBeat`, …). Notes carry `sd` (scale degree,
possibly with `#`/`b`), `octave` (relative), `beat` (1-based), `duration`
(beats), `isRest`. `notes` is a flat list for one voice or a list per voice;
voice 0 is the melody.

Pitch: `tonic + scale[mode][sd] + accidental + 12·octave`, where octave 0
starts on the tonic in MIDI octave 4 (Hookpad's own convention: the site
reports On Melancholy Hill's range as C#5–A5 and that is what this yields),
before the transposition policy below moves it. Sections are concatenated in page order,
each becoming a section marker; the tempo map and meter give seconds.
Chords are kept on the song as an optional accompaniment track (a later
feature can play them as glissandi). Timing is `measured`.

This is an undocumented endpoint and may change or go away. Import is one
song at a time, from a URL the user pastes, with a browser user agent, and
the parser lives behind fixtures so a format change fails a test rather than
a user. Paste-text import remains the fallback for everything.

### 6.5 Fitting an imported melody to the kalimba

Melodies come in any key and range. The import picks the transposition
(semitones, any octave) by these rules in order, and reports what it did:

1. A transposition where every note lands on a tine, preferring the
   smallest shift from the original key, then the smallest octave move.
2. Otherwise, the one that leaves the fewest notes needing an octave fold
   (a fold is an octave jump the player must make), then the smallest shift.
3. Otherwise, the one that leaves the fewest unplayable notes, then the
   fewest folds, then the smallest shift.

The user sees the chosen shift and can override it in the Add-song panel
(automatic, manual, or none).

A fit never destroys the import. The song file keeps the notes as imported
in `original` and describes the adjustment in `fit` (which kalimba it was
for, the shift, how many notes were folded or left unplayable, and whether
the app or the user chose it). The fitted notes are what plays. Switching to
another kalimba shows a banner offering to refit from the original or to
restore it, so a song fitted to a 17-key regains its sharps on a chromatic
instrument. Editing the text makes the text the new original and drops the
record.

### 6.6 Capability check

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
- Auto-update via the Tauri updater against this repo's releases; the repo
  is public so `latest.json` is fetchable anonymously. `scripts/release.mjs`
  bumps, tags and pushes; the `release` job in CI builds, signs and
  publishes with `latest.json`. See `RELEASING.md`.
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

---

## 16. Score mode: hearing the kalimba (draft)

Status: design only. Nothing below is built. Numbers are starting points
to be tuned against recordings of the real instrument, not decisions.

### 16.1 Goal and scope

Score mode: the user plays along on a real kalimba, the microphone hears
it, and the app grades the performance. It is built in two pieces because
everything rests on the first one:

1. **Listening** (this section): turn the microphone signal into "tine N
   was plucked at time T" events. Done when switching to score mode and
   plucking the real instrument lights the matching tines on the board, the
   bass row and chords included, with nothing lighting up in silence or
   from the metronome.
2. **Grading** (§16.9, sketched only): match those events against the
   song's notes and show a score.

Score mode is a mode of its own, exclusive with wait and record: those
are practice aids for learning a passage, score mode is a performance,
and mixing them would blur what a score means. Listening is still useful
before grading exists: it is the pitch source a later tuner mode builds
on (§16.6).

### 16.2 Why this is easier than general pitch tracking

The layout already says which frequencies can occur. A 46-key in C has 42
distinct pitches from C3 (130.8 Hz) to F6 (1396.9 Hz); a 17-key has 17.
Detection is not "what pitch is this?" but "which of these known
frequencies just started sounding?", a template question with the layout
as the prior. On a 17-key, an accidental heard from the room maps to no
tine and is ignored for free.

Kalimba acoustics help too. A plucked tine is a clamped-free bar: a strong
fundamental with a sharp attack and a ring of one to three seconds, and
overtones that are inharmonic (about 6.3× and 17.5× the fundamental, not
2× and 3×) and die within tens of milliseconds. So the fundamental is
always the loudest peak, there is almost no energy at the octave (octave
errors, the curse of guitar tuners, are rare), and the overtones can be
told from real notes by how fast they vanish.

The hard parts are the opposite ones: notes ring long and overlap, chords
are common, and the bass row's semitones are 8 to 14 Hz apart.

### 16.3 Rejected approaches

- **Monophonic pitch trackers** (YIN, autocorrelation, `pitchy`): one
  pitch at a time; a note ringing under a new one, or any chord, breaks
  them.
- **Neural pitch models** (CREPE via TensorFlow.js): a model file and a
  runtime for a problem the layout already constrains; against the
  zero-dependency rule.
- **Capturing audio in Rust** (`cpal`): more reliable across WebViews, but
  it introduces a second clock. Samples would arrive over IPC with no
  relation to the AudioContext the transport runs on, and score timing
  must be on the one clock (§9). Kept as the fallback for capture only if
  a WebView cannot open the microphone (§16.8).
- **Polling an `AnalyserNode` from the animation loop**: no build plumbing,
  but the hop is the frame interval and timestamps are whenever the frame
  happened to run. Fine for a spike, not for onset times.

### 16.4 Signal path

```
getUserMedia ──► MediaStreamAudioSourceNode ──► AudioWorkletNode ──► Gain(0) ──► destination
 (mono; echo cancellation, noise suppression   "pump": fixed-size hops   (keeps the node
  and auto gain all OFF: they are speech       posted to the main thread   pulled; nothing
  filters and mangle tones)                    with the AudioContext time  is audible)
                                               of the first sample
                                                        │
                                                        ▼
                                        Detector (pure TypeScript, no audio API)
                                                        │
                                                        ▼
                                  Listener emits DetectedHit → board, Practice, Scorer
```

The worklet is deliberately dumb: a ring buffer that posts one hop
(512 samples, about 11 ms at 48 kHz) at a time, stamped with the context
time of its first sample. All logic lives in a pure module the tests can
drive with arrays. Message rate is under 100 per second, negligible.

The microphone joins the AudioContext the synth already uses, so hit
times are on the transport's clock with no conversion. Enabling score mode
is a click, which satisfies the user-gesture rule (§13); `ensureAudio`
runs first.

The mic is never routed to the speakers.

```ts
interface DetectedHit {
  time: number;       // AudioContext seconds of the onset, not of the decision
  pitch: number;      // MIDI, after the tuning offset
  cents: number;      // how far from the tine's nominal pitch the peak sat
  tines: number[];    // every tine with that pitch (duplicates on upper tiers)
  strength: number;   // 0..1, relative to the recent loudest onset
}
```

### 16.5 Detector

Per hop, on a Hann-windowed frame of 4096 samples (85 ms at 48 kHz):

1. **Magnitude spectrum**, bins below about 100 Hz discarded (mains hum,
   desk thumps). A slow per-bin noise floor is tracked and subtracted.
2. **Spectral flux**: the positive part of the difference between this
   spectrum and the one from a few hops ago. Notes still ringing from
   before were already in the reference and cancel out; a decaying note
   goes negative and is clipped to zero. What remains is what is *new*.
   This is the whole trick for polyphony: a chord is several peaks in the
   flux, an arpeggio over a sustained note is one peak at a time.
3. **Onset**: the summed flux crosses an adaptive threshold (a multiple of
   its recent median, plus a floor) and is a local maximum. A hit's `time`
   is the hop where it crossed, so the decision may be late but the
   timestamp is not.
4. **Peaks**: local maxima in the flux at the onset, sharpened by parabolic
   interpolation to well under a bin, converted to cents from the nearest
   layout pitch. Accept within a tolerance (start at ±40 cents), reject
   the rest.
5. **Sustain check**: a candidate must still be present two hops later.
   The inharmonic overtones fail this (they are gone in 20 to 30 ms); so
   does the metronome click (40 ms of square wave) and a knock on the
   table. This is what lets the metronome stay on in score mode.
6. **Overtone mask**: once a fundamental is accepted, a weaker candidate
   near 6.3× it in the same onset is dropped. C3's overtone lands 22 cents
   from G♯5; the sustain check catches it, this is the belt to those
   braces.
7. **Refractory**: the same pitch cannot fire twice within 60 ms.

**The bass row.** An 85 ms window has bins 11.7 Hz wide; C3 and C♯3 are
7.8 Hz apart. Two things make it workable. Interpolation places a single
isolated peak to about a hertz, and simultaneous semitones in the bass do
not occur in tabs. If recordings show the row is still unreliable, the
next step is a second, longer window (8192 samples) that only confirms
pitches below C4, ending 100 to 170 ms after the onset. Kalimba notes ring
long enough for a late decision, and the hit keeps the onset's timestamp.

**Upgrade path.** If peak picking is not enough, the same flux can be
decomposed onto *measured* per-tine spectra captured in a calibration
pass (§16.6), a small non-negative least squares per onset. The plumbing
does not change; only step 4 does.

Everything above is a pure function of `(frame, state, layout, settings)`
and lives in `src/mic/detector.ts`, with `src/mic/tuning.ts` for Hz, MIDI
and cents. The worklet is `src/mic/pump.worklet.js`, plain JavaScript so
the bundler has nothing to transpile, loaded by URL. `src/mic/listener.ts`
owns `getUserMedia`, the graph, permissions, device choice and the level
meter, and is the only file that touches the audio API.

### 16.6 Tuning and calibration

Real kalimbas are not at A440 and single tines drift. Three layers:

1. **Tolerance** (default ±40 cents) absorbs small errors with no setup.
2. **Global offset**: the running median of `cents` over accepted hits.
   An instrument 15 cents flat moves the window after a few notes. Saved
   per layout in settings so it survives a restart.
3. **Per-tine offsets** (with the tuner, after this feature): a tuner
   mode plays through the instrument tine by tine, records each one's true
   frequency and spectrum, and stores `centsOffset` on the tine. That is
   where the measured spectra for §16.5's upgrade path come from.

**Tuner mode** is the next thing after listening works and reuses it. A
tuner needs one more thing than onsets: the pitch of a note *as it
rings*, so the needle can settle. The detector already interpolates the
peak at the onset; the tuner keeps re-reading that peak on the plain
magnitude spectrum for as long as the note sounds and shows the cents.
Nothing in the signal path changes, which is why `DetectedHit` carries
`cents` from the start.

**Latency.** The onset timestamp lags the pluck by the microphone's own
delay plus part of a window, roughly 30 to 60 ms and constant for a given
setup. Lighting a tine does not care; grading does. A `latencyMs` setting
is subtracted from hit times, defaulting to a guess from
`AudioContext.baseLatency` and the track's reported latency, with a later
calibration routine: play the metronome through the speakers, hear the
click, measure the round trip.

### 16.7 In the app

- **Mute is a transport-bar button of its own.** It silences the song's
  plucks (and accompaniment, when that exists) at a gain on the synth's
  pluck path; the falling notes and the landing glow carry on, so the
  song is still readable with the sound off. The metronome is not part of
  mute: it has its own switch, its click cannot fool the detector
  (§16.5), and it is the one sound a player on speakers wants while
  scoring. Mute exists independently of score mode; it is simply useful.
- **Score mode is a transport-bar toggle** next to wait and record, and
  exclusive with them: turning it on turns them off, and their buttons
  are disabled while it is on. On: request the mic, **switch mute on**
  (the instrument is the sound now, and the synth heard through the mic
  would grade the app against itself), show a small level meter so the
  user can see it is listening. Headphones are optional: a user wearing
  them can unmute and hear the song, and score mode leaves their choice
  alone for the rest of the session. Off: restore mute to what it was
  before, stop the track so the OS recording indicator goes away. Denied
  or no device: an error in the bar, mode stays off.
- **Microphone picker** next to the level meter, listing every input by
  the label the OS gives it, for a better mic or one placed nearer the
  instrument. Labels are only available after permission is granted, so
  the list fills on the first grant. The choice is saved; if the device
  is missing at the next start, fall back to the system default and say
  so in the bar rather than fail. Switching devices restarts the track
  and resets the detector's noise floor.
- **Heard tines glow** through the same highlight path a clicked tine
  uses, in a distinct colour from a note landing, so "the song wants this"
  and "I played this" read differently on the board.
- **Duplicate pitches** light every tine that carries the pitch. Audio
  cannot tell tiers apart; when a song is playing, grading prefers the
  tine the note is placed on.
- **Settings** gain a tolerant `mic` block: `deviceId`, `tuningCents` per
  layout, `latencyMs`, `sensitivity`, and a top-level `muted`. Missing
  means defaults.
- **Browser dev**: Chrome on `localhost` allows the microphone, so the
  whole feature works under `npm run dev` without Tauri.

### 16.8 Platforms and permissions

- **Windows (WebView2)**: `getUserMedia` is supported; wry routes the
  permission request and can raise the system prompt. The first spike
  confirms the prompt appears inside Tauri and that the answer sticks.
- **macOS (WKWebView)**: needs `NSMicrophoneUsageDescription` in
  `src-tauri/Info.plist` (Tauri merges it into the bundle) or the call
  fails silently. Blind build, so this is verified on a borrowed Mac
  before score mode is advertised for macOS.
- **Linux (webkit2gtk)**: capture depends on the distro's GStreamer
  plugins. Report "microphone not available here" cleanly rather than
  hang; not a launch target.
- Fallback if a WebView refuses the mic: capture in Rust with `cpal` and
  ship frames over a Tauri channel, resampling and timestamping against
  the AudioContext on arrival. Costs a native dependency and a clock
  alignment, so only if needed.

### 16.9 Grading (later, so the hit shape is right now)

For each expected note, the nearest hit of the same pitch within a window
(±80 ms full marks, ±150 ms partial, at the current tempo) claims it; each
hit claims at most one note. Notes with no hit are misses; hits that claim
nothing are extras and cost little (a brushed neighbour is the commonest
kalimba mistake). Per-note verdicts drive the live feedback on the falling
notes, a running percentage and streak sit in the bar, and a summary
shows at the end. A song fitted with unplayable notes excludes them from
the total. Scores are not saved in v1.

### 16.10 Testing without holding the instrument

- **Synthetic fixtures**: a generator that renders a decaying sine with a
  6.3× overtone and noise at any tine frequency, so tests cover single
  notes, a chord, an arpeggio over a ringing note, the bass row, a note
  repeated quickly, a metronome click, and silence. Onset within ±15 ms,
  pitch exact, no extras.
- **Real fixtures**: WAV recordings of the actual 46-key, captured
  through the app's own mic path by a debug "record 20 s" control added in
  the first spike, so the fixture has the same device processing the
  detector will see. Scripted takes: the fan ascending, the bass row, the
  sharps tier, a chord, a fast passage. Stored under `fixtures/audio/`
  with a text file naming the expected hits, read by a tiny WAV parser in
  the tests. Threshold tuning happens against these, and a change that
  breaks one fails CI, the same discipline as the MIDI and TheoryTab
  fixtures.

### 16.11 Risks

| Risk | Mitigation |
|---|---|
| Laptop mic DSP (Windows "audio enhancements") smears tones and cannot be disabled from the page | Fixtures recorded on that mic first; a device picker; sensitivity slider; document "an external mic helps" |
| Bass row semitones unresolved | Interpolated peaks first; longer confirmation window; template decomposition as the next step |
| The app's own sound reaches the mic | Score mode switches mute on; metronome fails the sustain check; a user who unmutes has chosen headphones and owns the result |
| WebView will not open the microphone | Verified in the first spike on Windows; Info.plist for macOS; `cpal` capture as the fallback |
| Thresholds tuned to one room | Adaptive noise floor and median-relative onset threshold; fixtures from more than one setup as friends try it |
