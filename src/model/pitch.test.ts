import { describe, expect, it } from "vitest";
import { parsePitch, pitchName } from "./pitch";

describe("pitch names", () => {
  it("names pitches in both spellings", () => {
    expect(pitchName(60)).toBe("C4");
    expect(pitchName(61)).toBe("C#4");
    expect(pitchName(61, "flat")).toBe("Db4");
    expect(pitchName(59)).toBe("B3");
    expect(pitchName(89)).toBe("F6");
  });

  it("parses names, accidentals and numbers", () => {
    expect(parsePitch("C4")).toBe(60);
    expect(parsePitch("c4")).toBe(60);
    expect(parsePitch("F#5")).toBe(78);
    expect(parsePitch("Gb5")).toBe(78);
    expect(parsePitch("B♭3")).toBe(58);
    expect(parsePitch(" 72 ")).toBe(72);
    expect(parsePitch("H4")).toBeNull();
    expect(parsePitch("C")).toBeNull();
    expect(parsePitch("200")).toBeNull();
  });

  it("round-trips", () => {
    for (let p = 24; p <= 108; p++) {
      expect(parsePitch(pitchName(p))).toBe(p);
      expect(parsePitch(pitchName(p, "flat"))).toBe(p);
    }
  });
});
