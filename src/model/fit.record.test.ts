import { describe, expect, it } from "vitest";
import { fittedElsewhere, refitSong, restoreOriginal } from "./fit";
import { parseNotation } from "./notation";
import { coerceSong, songFromText } from "./song";
import { presetById } from "../presets";

const seventeen = presetById("standard-17")!;
const chromatic = presetById("chill-angels-46")!;

// A D-major phrase with a C# and an F#: not on a C-major 17-key.
const pure = songFromText("2 3 4# 5 6 7 1#° 2°", { title: "t", bpm: 60 }, parseNotation("2 3 4# 5 6 7 1#° 2°").events);

describe("recorded fits", () => {
  it("fits for a 17-key, keeps the original, and refits for a 46-key from the original", () => {
    const small = refitSong(pure, seventeen);
    expect(small.fit).toMatchObject({ layoutId: "standard-17", semitones: -2, octaves: 0, folded: 0, unplayable: 0, auto: true });
    expect(small.original!.notes.map((n) => n.pitch)).toEqual(pure.notes.map((n) => n.pitch));
    expect(small.notes.map((n) => n.pitch)).toEqual(pure.notes.map((n) => n.pitch - 2));
    expect(small.text).toBe("1 2 3 4\n5 6 7 1°"); // one bar per line at 60 BPM

    // Switching to a chromatic kalimba: the refit starts from the original, not from the C-major version.
    expect(fittedElsewhere(small, chromatic)).toBe(true);
    const big = refitSong(small, chromatic);
    expect(big.fit).toMatchObject({ layoutId: "chill-angels-46", semitones: 0, octaves: 0, unplayable: 0 });
    expect(big.notes.map((n) => n.pitch)).toEqual(pure.notes.map((n) => n.pitch));
    expect(fittedElsewhere(big, chromatic)).toBe(false);
  });

  it("restores the original and drops the record", () => {
    const small = refitSong(pure, seventeen);
    const back = restoreOriginal(small);
    expect(back.fit).toBeUndefined();
    expect(back.original).toBeUndefined();
    expect(back.notes.map((n) => n.pitch)).toEqual(pure.notes.map((n) => n.pitch));
    expect(back.text).toBe("2 3 4# 5\n6 7 1#° 2°");
    expect(restoreOriginal(pure)).toBe(pure);
  });

  it("records a manual override as not automatic", () => {
    const manual = refitSong(pure, seventeen, { semitones: 3, octaves: -1 });
    expect(manual.fit).toMatchObject({ semitones: 3, octaves: -1, auto: false });
    // D4 shifted by -9 is F3, below the 17-key, so it folds up to F4 and is counted.
    expect(manual.notes[0].pitch).toBe(pure.notes[0].pitch + 3);
    expect(manual.fit!.folded).toBeGreaterThan(0);
  });

  it("survives the song file round trip", () => {
    const small = refitSong(pure, seventeen);
    const back = coerceSong(JSON.parse(JSON.stringify(small)))!;
    expect(back.fit).toEqual(small.fit);
    expect(back.original).toEqual(small.original);
    // A file with a fit but no original is treated as plain notes.
    const stripped = JSON.parse(JSON.stringify(small));
    delete stripped.original;
    expect(coerceSong(stripped)!.fit).toBeUndefined();
  });
});
