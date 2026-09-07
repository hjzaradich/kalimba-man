# Kalimba Man

Learn kalimba songs by playing along: import a tab from kalimbatabs.net and
watch numbered notes fall onto a drawing of your kalimba's tines.

Status: phase 6 of `ROADMAP.md`. Import a tab from a kalimbatabs.net URL
(with exact timing when the post has MIDI), a melody with its rhythm from a
hooktheory.com TheoryTab page, any MIDI file, or paste one; keep songs in a
library as shareable files; edit the notation; play along on a 17-key,
21-key or Chill Angels 46-key board with synthesized sound; loop a section,
add a metronome, hold at each note in wait mode, or tap the rhythm into a
song that had none. Define your own kalimba, tiers and labels included, and
share it as a file. Installers come next.

## Develop

Requirements: Node 22+, Rust stable, and on Linux the WebKitGTK packages
listed in `.github/workflows/ci.yml`.

```
npm install
npm run tauri dev
```

`npm run dev` serves the frontend alone in a browser for quick UI work.
`npm test` runs the frontend tests; `cargo test` in `src-tauri` runs the
Rust ones.

## Install

Grab the installer for your system from the
[releases page](https://github.com/hjzaradich/kalimba-man/releases), under
*Assets* on the newest release: the `_x64-setup.exe` on Windows, the
`_universal.dmg` on macOS, the `.AppImage` (or `.deb`/`.rpm`) on Linux. The
`.sig` files and `latest.json` are for the in-app updater.
Nothing is code-signed (that costs money), so the first run shows a warning:

- **Windows**: SmartScreen says the publisher is unknown. Click *More info*,
  then *Run anyway*. The installer needs no admin rights.
- **macOS**: right-click the app and choose *Open*, then confirm. On newer
  macOS go to *System Settings → Privacy & Security → Open Anyway* instead.
  If it still refuses, or says the app is damaged, run
  `xattr -cr "/Applications/Kalimba Man.app"` in Terminal and open it again.
- **Linux**: `chmod +x` the AppImage once, or install the `.deb`.

The app checks for updates when it starts and offers to install them.
Releasing is described in `RELEASING.md`.

## Where data lives

Songs, layouts and settings are plain files in the platform app-data folder
(shown in the app's status bar). Delete the folder to reset the app; copy a
song file to share it.
