import { describe, expect, it } from "vitest";
import { parseNotation } from "./notation";
import { presetById } from "../presets";
import { songFromText } from "./song";
import { bestTransposition, checkCapability, foldOctaves } from "./capability";

const mk = (text: string) => songFromText(text, { title: "t" }, parseNotation(text).events);

describe("capability", () => {
  const seventeen = presetById("standard-17")!;
  const chromatic = presetById("chill-angels-46")!;

  it("reports notes a 17-key cannot play", () => {
    const song = mk("1 1# .7 1°°°");
    const r = checkCapability(song, seventeen);
    expect(r.unplayable).toEqual([1, 2, 3]);
    expect(r.missingPitches).toEqual([59, 61, 96]);
    expect(checkCapability(mk("1 1# .7"), chromatic).unplayable).toEqual([]);
  });

  it("finds the transposition that fixes a sharp-heavy tab", () => {
    // A tune in D: degrees with sharps a 17-key lacks.
    const song = mk("2 3 4# 5 6 7 1#° 2°");
    expect(checkCapability(song, seventeen).unplayable.length).toBe(2);
    const best = bestTransposition(song, seventeen);
    expect(best.unplayable).toBe(0);
    expect(best.semitones).toBe(-2);
  });

  it("prefers no change when nothing is unplayable", () => {
    expect(bestTransposition(mk("1 2 3"), seventeen)).toEqual({ semitones: 0, unplayable: 0 });
  });

  it("folds out-of-range notes by octaves and leaves the rest", () => {
    const song = mk("1 .1 1°°° 1#");
    const folded = foldOctaves(song, seventeen);
    expect(folded.notes.map((n) => n.pitch)).toEqual([60, 60, 84, 61]);
    // Nothing to fold: the same object comes back.
    const fine = mk("1 2");
    expect(foldOctaves(fine, seventeen)).toBe(fine);
  });
});
