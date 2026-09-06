import { describe, expect, it } from "vitest";
import { computeBoardGeometry, referenceTier } from "./geometry";
import { PRESET_LAYOUTS, presetById } from "../presets";

describe("computeBoardGeometry", () => {
  it("gives every tine a lane inside the board and a tip below its bridge", () => {
    for (const layout of PRESET_LAYOUTS) {
      const geo = computeBoardGeometry(layout, 1000, 400);
      expect(geo.tines).toHaveLength(layout.tines.length);
      for (const g of geo.tines) {
        expect(g.cx).toBeGreaterThan(0);
        expect(g.cx).toBeLessThan(1000);
        expect(g.tip).toBeGreaterThan(g.top);
        expect(g.tip).toBeLessThanOrEqual(400);
        expect(g.top).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("makes lower pitches longer", () => {
    const layout = presetById("standard-17")!;
    const geo = computeBoardGeometry(layout, 1000, 400);
    const length = (i: number) => geo.tines[i].tip - geo.tines[i].top;
    const centre = layout.tines.findIndex((t) => t.pitch === 60);
    const edge = layout.tines.findIndex((t) => t.pitch === 88);
    expect(length(centre)).toBeGreaterThan(length(edge));
    // Symmetric neighbours of the centre are close in length.
    expect(Math.abs(length(centre - 1) - length(centre + 1))).toBeLessThan(400 * 0.05);
  });

  it("anchors every tier on one bridge line and staggers only the tips", () => {
    const layout = presetById("chill-angels-46")!;
    const geo = computeBoardGeometry(layout, 1200, 500);
    const bridge = (layer: number) => geo.layers[layer].bridgeY;
    expect(bridge(1)).toBe(bridge(0));
    expect(bridge(2)).toBe(bridge(0));
    expect(geo.hitY).toBe(bridge(0));
    for (const g of geo.tines) expect(g.top).toBe(geo.hitY);
    // In one column, tips step upward tier by tier: bass lowest, sharps highest.
    const inColumn = (layer: number) => geo.tines.find((g) => g.layer === layer && layout.tines[g.index].x === 8)!;
    const [bass, main, sharp] = [inColumn(0), inColumn(1), inColumn(2)];
    expect(main.tip).toBeLessThan(bass.tip);
    expect(sharp.tip).toBeLessThan(main.tip);
    // Shifted by each tier's xShift, in lane widths.
    const lane = geo.laneWidth;
    expect(bass.cx - main.cx).toBeCloseTo(((layout.layers[0].xShift ?? 0) - (layout.layers[1].xShift ?? 0)) * lane, 6);
    expect(sharp.cx - main.cx).toBeCloseTo(((layout.layers[2].xShift ?? 0) - (layout.layers[1].xShift ?? 0)) * lane, 6);
  });

  it("spaces the tips in every column evenly, whatever the pitches", () => {
    const layout = presetById("chill-angels-46")!;
    const geo = computeBoardGeometry(layout, 1200, 500);
    const gaps: number[] = [];
    for (let x = 0; x < 17; x++) {
      const inColumn = (layer: number) => geo.tines.find((g) => g.layer === layer && layout.tines[g.index].x === x);
      const [bass, main, sharp] = [inColumn(0), inColumn(1), inColumn(2)];
      expect(main && sharp).toBeTruthy();
      gaps.push(main!.tip - sharp!.tip);
      if (bass) gaps.push(bass.tip - main!.tip);
    }
    // The bass 7 under the fan's 5^ must be as visible as the bass 1 under 1.
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
    expect(gaps[0]).toBeGreaterThan(500 * 0.08);
  });

  it("chooses the fan as the reference tier on the 46-key", () => {
    expect(referenceTier(presetById("chill-angels-46")!)).toBe(1);
    expect(referenceTier(presetById("standard-17")!)).toBe(0);
  });

  it("keeps stacked tines overlapping the tier beneath", () => {
    const layout = presetById("chill-angels-46")!;
    const geo = computeBoardGeometry(layout, 1200, 500);
    for (const g of geo.tines) {
      const tine = layout.tines[g.index];
      if (tine.layer === 0) continue;
      const below = geo.tines.find((o) => o.layer === tine.layer - 1 && layout.tines[o.index].x === tine.x);
      if (!below) continue;
      expect(Math.abs(g.cx - below.cx), `slot ${tine.x} layer ${tine.layer}`).toBeLessThan(g.width);
    }
  });

  it("keeps shifted tines inside the board", () => {
    for (const layout of PRESET_LAYOUTS) {
      const geo = computeBoardGeometry(layout, 900, 400);
      for (const g of geo.tines) {
        expect(g.cx - g.width / 2).toBeGreaterThanOrEqual(0);
        expect(g.cx + g.width / 2).toBeLessThanOrEqual(900);
      }
    }
  });

  it("divides width evenly into slots", () => {
    const geo = computeBoardGeometry(presetById("standard-17")!, 850, 300);
    expect(geo.slots).toBe(17);
    expect(geo.laneWidth).toBe(50);
    expect(geo.tines[0].cx).toBe(25);
  });
});
