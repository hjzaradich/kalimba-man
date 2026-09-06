import { describe, expect, it } from "vitest";
import {
  fanOrder,
  labelForPitch,
  octaveDotsForPitch,
  pitchForLabel,
  tineForPitch,
  tinesForPitch,
  validateLayout,
  type Layout,
} from "./layout";

describe("labels", () => {
  it("prints C-major degrees with C4 as plain 1", () => {
    expect(labelForPitch(60)).toBe("1");
    expect(octaveDotsForPitch(60)).toBe(0);
    expect(labelForPitch(71)).toBe("7");
    expect(labelForPitch(72)).toBe("1");
    expect(octaveDotsForPitch(72)).toBe(1);
    expect(octaveDotsForPitch(48)).toBe(-1);
    expect(octaveDotsForPitch(84)).toBe(2);
  });

  it("prints accidentals in the requested style", () => {
    expect(labelForPitch(61, "sharp")).toBe("1#");
    expect(labelForPitch(61, "flat")).toBe("2b");
    expect(labelForPitch(70, "sharp")).toBe("6#");
    expect(labelForPitch(70, "flat")).toBe("7b");
  });

  it("round-trips label and dots back to a pitch", () => {
    for (let p = 36; p <= 100; p++) {
      for (const style of ["sharp", "flat"] as const) {
        expect(pitchForLabel(labelForPitch(p, style), octaveDotsForPitch(p))).toBe(p);
      }
    }
    expect(pitchForLabel("8", 0)).toBeNull();
    expect(pitchForLabel("x", 0)).toBeNull();
  });
});

describe("fanOrder", () => {
  it("reproduces the 17-key left-to-right order", () => {
    const asc = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86, 88];
    // D6 B5 G5 E5 C5 A4 F4 D4 | C4 | E4 G4 B4 D5 F5 A5 C6 E6
    expect(fanOrder(asc)).toEqual([86, 83, 79, 76, 72, 69, 65, 62, 60, 64, 67, 71, 74, 77, 81, 84, 88]);
  });

  it("handles tiny inputs", () => {
    expect(fanOrder([60])).toEqual([60]);
    expect(fanOrder([60, 62])).toEqual([62, 60]);
    expect(fanOrder([60, 62, 64])).toEqual([62, 60, 64]);
  });
});

function twoLayer(): Layout {
  return {
    id: "t",
    name: "Test",
    tuning: "C",
    accidentalStyle: "sharp",
    layers: [
      { name: "Bottom", color: "#fff" },
      { name: "Top", color: "#000" },
    ],
    tines: [tineForPitch(60, 0, 0), tineForPitch(62, 0, 1), tineForPitch(60, 1, 0)],
  };
}

describe("tinesForPitch", () => {
  it("prefers the lowest tier when a pitch is duplicated", () => {
    expect(tinesForPitch(twoLayer(), 60)).toEqual([0, 2]);
    expect(tinesForPitch(twoLayer(), 62)).toEqual([1]);
    expect(tinesForPitch(twoLayer(), 61)).toEqual([]);
  });
});

describe("validateLayout", () => {
  it("accepts a well-formed layout", () => {
    expect(validateLayout(twoLayer())).toEqual([]);
  });

  it("reports bad layers, slots, labels and collisions", () => {
    const l = twoLayer();
    l.tines.push({ pitch: 64, label: "9", octaveDots: 0, layer: 5, x: -1 });
    l.tines.push({ pitch: 65, label: "4", octaveDots: 0, layer: 0, x: 1 });
    const messages = validateLayout(l).map((p) => p.message);
    expect(messages.some((m) => m.includes("layer 5"))).toBe(true);
    expect(messages.some((m) => m.includes("invalid slot"))).toBe(true);
    expect(messages.some((m) => m.includes('label "9"'))).toBe(true);
    expect(messages.some((m) => m.includes("both occupy slot 1"))).toBe(true);
  });
});
