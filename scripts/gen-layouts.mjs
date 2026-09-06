// Generates the preset layout files in layouts/. Run: node scripts/gen-layouts.mjs
//
// The JSON files are the source of truth the app ships; this script exists so
// the presets are derived from pitch lists rather than hand-typed 46 times.
// Re-run it after editing, then review the diff.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "layouts");

const C4 = 60;
const DEGREE_OF_PC = [1, null, 2, null, 3, 4, null, 5, null, 6, null, 7];

function label(pitch) {
  const pc = pitch % 12;
  const d = DEGREE_OF_PC[pc];
  if (d !== null) return String(d);
  return `${DEGREE_OF_PC[pc - 1]}#`;
}
function dots(pitch) {
  return Math.floor(pitch / 12) - Math.floor(C4 / 12);
}
function tine(pitch, layer, x, extra = {}) {
  return { pitch, label: label(pitch), octaveDots: dots(pitch), layer, x, ...extra };
}
/** Lowest pitch in the centre, then alternate left, right outward. */
function fanOrder(asc) {
  const left = [], right = [];
  asc.forEach((p, i) => { if (i > 0) (i % 2 === 1 ? left : right).push(p); });
  return [...left.reverse(), asc[0], ...right];
}
/** MIDI pitches of the C-major naturals from `from` to `to` inclusive. */
function naturals(from, to) {
  const out = [];
  for (let p = from; p <= to; p++) if (DEGREE_OF_PC[p % 12] !== null) out.push(p);
  return out;
}

const MAIN = { name: "Main", color: "#d9dee8" };
// Stacked tiers are nudged sideways so their falling-note lanes do not sit
// exactly over one another. The real tines are in one column. The shift is
// a staircase around the main tier (bass left, sharps right) and smaller than
// the tine width (0.42 lanes), so every tine still overlaps its neighbour in
// the stack and the column reads as one.
const TIER_STEP = 0.2;
const BASS = { name: "Bass", color: "#7cc0ff", xShift: -TIER_STEP };
const SHARPS = { name: "Sharps", color: "#f2b25c", xShift: TIER_STEP };

// ---- standard-17: C4..E6 diatonic fan ---------------------------------------
const fan17 = fanOrder(naturals(60, 88));
const standard17 = {
  id: "standard-17",
  name: "Standard 17-key (C major)",
  tuning: "C",
  accidentalStyle: "sharp",
  layers: [MAIN],
  tines: fan17.map((p, x) => tine(p, 0, x)),
  notes: "C4 to E6. The layout nearly every 17-key kalimba ships with.",
};

// ---- standard-21: 17-key plus F3 G3 A3 B3 in the centre ---------------------
const fan21 = fanOrder(naturals(53, 88));
const standard21 = {
  id: "standard-21",
  name: "Standard 21-key (C major)",
  tuning: "C",
  accidentalStyle: "sharp",
  layers: [MAIN],
  tines: fan21.map((p, x) => tine(p, 0, x)),
  notes: "F3 to E6. The four bass tines sit in the centre; the outer 17 match the 17-key exactly.",
};

// ---- chill-angels-46: three tiers, chromatic C3..F6 -------------------------
// Tier 0 (bottom, against the soundboard): the bass octave, C3..B3 naturals
// then the five octave-3 sharps, one column each. Tier 1: the 17-key fan.
// Tier 2 (top): over each fan tine, that tine's sharp, or for E and B, which
// have none, the natural above. The bass row is aligned so that C3 sits in
// the same column as C4 and C#4, which fixes its slots to 2..13.
// See layouts/README.md for what has and has not been verified.
const mainPitches = fan17;
// One semitone up in every case: C->C#, D->D#, F->F#, G->G#, A->A#, and for
// E and B (no sharp) the natural above, F and C.
const sharpsPitches = mainPitches.map((p) => p + 1);
const bassPitches = [59, 57, 55, 53, 52, 50, 48, 49, 51, 54, 56, 58];
const BASS_SLOT_OFFSET = mainPitches.indexOf(60) - bassPitches.indexOf(48); // 2

const chillAngels46 = {
  id: "chill-angels-46",
  name: "Chill Angels 46-key (chromatic, C)",
  tuning: "C",
  accidentalStyle: "sharp",
  layers: [BASS, MAIN, SHARPS],
  draft: true,
  notes: "Transcribed from the product diagram, not yet checked against the instrument.",
  tines: [
    ...bassPitches.map((p, i) => tine(p, 0, i + BASS_SLOT_OFFSET)),
    ...mainPitches.map((p, x) => tine(p, 1, x)),
    ...sharpsPitches.map((p, x) => tine(p, 2, x)),
  ],
};

for (const layout of [standard17, standard21, chillAngels46]) {
  const file = join(outDir, `${layout.id}.layout.json`);
  writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
  console.log(`${layout.id}: ${layout.tines.length} tines -> ${file}`);
}
