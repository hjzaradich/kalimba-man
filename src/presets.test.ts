import { describe, expect, it } from "vitest";
import { labelForPitch, octaveDotsForPitch, validateLayout } from "./model/layout";
import { PRESET_LAYOUTS, presetById } from "./presets";

describe("preset layouts", () => {
  it("all validate", () => {
    for (const layout of PRESET_LAYOUTS) {
      expect(validateLayout(layout), layout.id).toEqual([]);
    }
  });

  it("labels agree with the C-major printing convention", () => {
    for (const layout of PRESET_LAYOUTS) {
      for (const t of layout.tines) {
        expect(t.label, `${layout.id} pitch ${t.pitch}`).toBe(labelForPitch(t.pitch, layout.accidentalStyle));
        expect(t.octaveDots, `${layout.id} pitch ${t.pitch}`).toBe(octaveDotsForPitch(t.pitch));
      }
    }
  });

  it("standard-17 is the familiar fan", () => {
    const l = presetById("standard-17")!;
    expect(l.tines.map((t) => t.pitch)).toEqual([86, 83, 79, 76, 72, 69, 65, 62, 60, 64, 67, 71, 74, 77, 81, 84, 88]);
    expect(l.tines.map((t) => t.label).join(" ")).toBe("2 7 5 3 1 6 4 2 1 3 5 7 2 4 6 1 3");
  });

  it("standard-21 keeps the outer 17 and adds F3..B3 in the centre", () => {
    const l = presetById("standard-21")!;
    const pitches = l.tines.map((t) => t.pitch);
    expect(pitches).toHaveLength(21);
    expect(pitches.slice(0, 8)).toEqual([86, 83, 79, 76, 72, 69, 65, 62]);
    expect(pitches.slice(-8)).toEqual([64, 67, 71, 74, 77, 81, 84, 88]);
    expect(pitches.slice(8, 13)).toEqual([59, 55, 53, 57, 60]);
  });

  it("chill-angels-46 covers C3..F6 chromatically with exactly four duplicates", () => {
    const l = presetById("chill-angels-46")!;
    expect(l.tines).toHaveLength(46);
    expect(l.draft).toBe(true);
    const pitches = l.tines.map((t) => t.pitch);
    const unique = new Set(pitches);
    for (let p = 48; p <= 89; p++) {
      expect(unique.has(p), `missing MIDI ${p}`).toBe(true);
    }
    expect(unique.size).toBe(42);
    expect(pitches.length - unique.size).toBe(4);
    // Tier order bottom-up: bass, main fan, sharps.
    expect(l.layers.map((s) => s.name)).toEqual(["Bass", "Main", "Sharps"]);
    // The main tier is the plain 17-key fan.
    const main = l.tines.filter((t) => t.layer === 1).map((t) => t.pitch);
    expect(main).toEqual(presetById("standard-17")!.tines.map((t) => t.pitch));
    // Each sharps tine sits one semitone above the main tine in its column.
    for (const t of l.tines.filter((t) => t.layer === 2)) {
      const below = l.tines.find((f) => f.layer === 1 && f.x === t.x)!;
      expect(t.pitch).toBe(below.pitch + 1);
    }
    // The bass row is aligned by column: C3 under C4 under C#4.
    const column = (pitch: number) => l.tines.find((t) => t.pitch === pitch)!.x;
    expect(column(48)).toBe(column(60));
    expect(column(48)).toBe(column(61));
    expect(l.tines.filter((t) => t.layer === 0).map((t) => t.x)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});
