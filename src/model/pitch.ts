// Pitch names for the layout editor: "C4", "F#5", "Bb3", or a plain MIDI
// number. C4 = 60.

const NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4", "F#5", "Bb3". Style picks how black keys are spelled. */
export function pitchName(pitch: number, style: "sharp" | "flat" = "sharp"): string {
  const names = style === "flat" ? NAMES_FLAT : NAMES_SHARP;
  const octave = Math.floor(pitch / 12) - 1;
  return `${names[((pitch % 12) + 12) % 12]}${octave}`;
}

/** Accepts note names in either spelling, with ♯/♭ too, or a MIDI number. Null when unreadable. */
export function parsePitch(text: string): number | null {
  const t = text.trim();
  if (/^\d{1,3}$/.test(t)) {
    const n = Number(t);
    return n >= 0 && n <= 127 ? n : null;
  }
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(t);
  if (!m) return null;
  let pc = SEMITONE[m[1].toUpperCase()];
  if (m[2] === "#" || m[2] === "♯") pc += 1;
  if (m[2] === "b" || m[2] === "♭") pc -= 1;
  const pitch = (Number(m[3]) + 1) * 12 + pc;
  return pitch >= 0 && pitch <= 127 ? pitch : null;
}
