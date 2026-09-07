import { describe, expect, it } from "vitest";
import { coerceLayout } from "./layouts";
import { presetById } from "./presets";

describe("coerceLayout", () => {
  it("accepts a preset round-tripped through JSON", () => {
    const preset = presetById("chill-angels-46")!;
    const back = coerceLayout(JSON.parse(JSON.stringify(preset)));
    expect(back).toEqual(preset);
  });

  it("rejects junk and structurally broken files", () => {
    expect(coerceLayout(null)).toBeNull();
    expect(coerceLayout({ name: "x" })).toBeNull();
    expect(coerceLayout({ name: "x", layers: [{ name: "a", color: "#fff" }], tines: [{ pitch: 60, label: "1", layer: 3, x: 0 }] })).toBeNull();
    expect(coerceLayout({ name: "x", layers: [], tines: [] })).toBeNull();
    expect(
      coerceLayout({
        name: "x",
        layers: [{ name: "a", color: "#fff" }],
        tines: [
          { pitch: 60, label: "1", layer: 0, x: 0 },
          { pitch: 62, label: "2", layer: 0, x: 0 },
        ],
      }),
    ).toBeNull();
  });

  it("fills defaults for optional fields", () => {
    const l = coerceLayout({ name: "x", layers: [{ name: "a", color: "#fff" }], tines: [{ pitch: 60, label: "1", layer: 0, x: 0 }] })!;
    expect(l.accidentalStyle).toBe("sharp");
    expect(l.draft).toBe(false);
    expect(l.tines[0].octaveDots).toBe(0);
    expect(l.tuning).toBe("C");
  });
});
