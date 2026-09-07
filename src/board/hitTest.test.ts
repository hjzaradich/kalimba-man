import { describe, expect, it } from "vitest";
import { computeBoardGeometry } from "./geometry";
import { tineAt } from "./hitTest";
import { presetById } from "../presets";

describe("tineAt", () => {
  it("finds the tine under a point and prefers the top tier", () => {
    const layout = presetById("chill-angels-46")!;
    const geo = computeBoardGeometry(layout, 1200, 500);
    const main1 = geo.tines.find((g) => g.layer === 1 && layout.tines[g.index].pitch === 60)!;
    // Near the tip of the main C4: only the main tine is there.
    expect(tineAt(geo, main1.cx, main1.tip - 5)).toBe(main1.index);
    // Near the bridge in the same column the sharps tier sits on top.
    const sharp = geo.tines.find((g) => g.layer === 2 && layout.tines[g.index].x === layout.tines[main1.index].x)!;
    expect(tineAt(geo, sharp.cx, sharp.top + 10)).toBe(sharp.index);
    // Off the board.
    expect(tineAt(geo, 5, 495)).toBeNull();
  });
});
