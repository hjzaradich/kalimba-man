# Kalimba Man

Learn kalimba songs by playing along: import a tab from kalimbatabs.net and
watch numbered notes fall onto a drawing of your kalimba's tines.

Status: phase 2 of `ROADMAP.md`. Import a tab from a kalimbatabs.net URL
(with exact timing when the post has MIDI), or paste one; keep songs in a
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

## Where data lives

Songs, layouts and settings are plain files in the platform app-data folder
(shown in the app's status bar). Delete the folder to reset the app; copy a
song file to share it.
