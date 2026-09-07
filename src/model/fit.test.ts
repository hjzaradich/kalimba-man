import { describe, expect, it } from "vitest";
import { applyFit, bestFit, describeFit, evaluateFit } from "./fit";
import { presetById } from "../presets";

const seventeen = presetById("standard-17")!;
const chromatic = presetById("chill-angels-46")!;

describe("bestFit", () => {
  it("leaves a melody alone when it already fits", () => {
    const f = bestFit([60, 64, 67, 72, 76], seventeen);
    expect(f).toMatchObject({ shift: 0, folded: 0, unplayable: 0 });
  });

  it("transposes a D major melody down to C for a 17-key rather than folding", () => {
    // D5 E5 F#5 A5 B5 C#6: F#5 and C#6 are off a C-major 17-key.
    const f = bestFit([74, 76, 78, 81, 83, 85], seventeen);
    expect(f.unplayable).toBe(0);
    expect(f.folded).toBe(0);
    expect(f.semitones).toBe(-2);
  });

  it("prefers an octave move to a key change when both fit", () => {
    // C6 D6 E6 F6 G6: F6 and G6 are above the 17-key's E6.
    const f = bestFit([84, 86, 88, 89, 91], seventeen);
    expect(f.unplayable).toBe(0);
    expect(f.folded).toBe(0);
    expect(f.semitones).toBe(0);
    expect(f.octaves).toBe(-1);
  });

  it("minimises folds when nothing fits whole, then unplayable notes", () => {
    // Three octaves of C major: no 17-key holds it all.
    const wide = [48, 55, 60, 67, 72, 79, 84, 91, 96];
    const f = bestFit(wide, seventeen);
    expect(f.unplayable).toBe(0);
    expect(f.folded).toBeGreaterThan(0);
    // A chromatic 46-key needs nothing.
    expect(bestFit([61, 63, 66, 68, 70], chromatic)).toMatchObject({ shift: 0, folded: 0, unplayable: 0 });
  });

  it("reports unplayable notes only when no octave helps", () => {
    const f = evaluateFit([61], seventeen, 0, 0); // C#4 on a diatonic kalimba, forced shift 0
    expect(f.unplayable).toBe(1);
    expect(bestFit([61, 63], seventeen).unplayable).toBe(0); // shifts to C D
  });

  it("applies and describes", () => {
    const r = applyFit([60, 96], 0, new Set([60, 72, 84]));
    expect(r.pitches).toEqual([60, 84]);
    expect(r.folded).toBe(1);
    expect(describeFit({ shift: -2, semitones: -2, octaves: 0, folded: 0, unplayable: 0 }, "D")).toBe("down 2 semitones (D → C)");
    expect(describeFit({ shift: 12, semitones: 0, octaves: 1, folded: 2, unplayable: 1 })).toBe("up 1 octave, 2 notes folded by an octave, 1 unplayable");
    expect(describeFit({ shift: 0, semitones: 0, octaves: 0, folded: 0, unplayable: 0 })).toBe("no transposition");
  });
});
