import { describe, expect, it } from "vitest";
import { computeBoardGeometry } from "./geometry";
import { playerTineAt, tineAt } from "./hitTest";
import { presetById } from "../presets";

const layout46 = presetById("chill-angels-46")!;

describe("tineAt", () => {
  it("finds the tine under a point and prefers the top tier", () => {
    const geo = computeBoardGeometry(layout46, 1200, 500);
    const main1 = geo.tines.find((g) => g.layer === 1 && layout46.tines[g.index].pitch === 60)!;
    // Near the tip of the main C4: only the main tine is there.
    expect(tineAt(geo, main1.cx, main1.tip - 5)).toBe(main1.index);
    // Near the bridge in the same column the sharps tier sits on top.
    const sharp = geo.tines.find((g) => g.layer === 2 && layout46.tines[g.index].x === layout46.tines[main1.index].x)!;
    expect(tineAt(geo, sharp.cx, sharp.top + 10)).toBe(sharp.index);
    // Off the board.
    expect(tineAt(geo, 5, 495)).toBeNull();
  });

  it("reaches the bass tips that show below the tiers on top of them", () => {
    const geo = computeBoardGeometry(layout46, 1200, 500);
    for (const g of geo.tines.filter((t) => t.layer === 0)) {
      expect(tineAt(geo, g.cx, g.tip - 3)).toBe(g.index);
    }
  });

  it("picks the nearest tine within the slack, and nothing beyond it", () => {
    const geo = computeBoardGeometry(layout46, 1200, 500);
    // The bottom tier's tips have nothing beneath them; just below one is
    // a miss when exact and a hit with a little slack.
    const bass = geo.tines.find((g) => g.layer === 0 && layout46.tines[g.index].pitch === 48)!;
    expect(tineAt(geo, bass.cx, bass.tip + 6)).toBeNull();
    expect(tineAt(geo, bass.cx, bass.tip + 6, 8)).toBe(bass.index);
    expect(tineAt(geo, bass.cx, bass.tip + 30, 8)).toBeNull();
    // In the empty gap between two lanes of a single-tier board, inside no
    // tine, the closer one wins; a point inside a tine always beats a near miss.
    const seventeen = presetById("standard-17")!;
    const flat = computeBoardGeometry(seventeen, 800, 400);
    const [left, right] = [...flat.tines].sort((a, b) => a.cx - b.cx).slice(8, 10);
    const gapX = (left.cx + right.cx) / 2 + (right.cx - left.cx) * 0.1;
    const y = Math.min(left.tip, right.tip) - 20;
    expect(tineAt(flat, gapX, y)).toBeNull();
    expect(tineAt(flat, gapX, y, 40)).toBe(right.index);
    expect(tineAt(flat, right.cx, y, 40)).toBe(right.index);
  });

  it("does the same on a single-tier board", () => {
    const layout = presetById("standard-17")!;
    const geo = computeBoardGeometry(layout, 800, 400);
    for (const g of geo.tines) {
      expect(tineAt(geo, g.cx, (g.top + g.tip) / 2)).toBe(g.index);
      expect(layout.tines[g.index]).toBeDefined();
    }
  });
});

describe("playerTineAt", () => {
  it("maps a canvas click through the lane offset onto the same tine the renderer draws", () => {
    const width = 1000;
    const height = 600;
    const boardFraction = 0.46;
    const boardHeight = Math.round(height * boardFraction);
    const laneHeight = height - boardHeight;
    const geo = computeBoardGeometry(layout46, width, boardHeight);
    const g = geo.tines.find((t) => t.layer === 1 && layout46.tines[t.index].pitch === 67)!;
    expect(playerTineAt(layout46, width, height, boardFraction, g.cx, laneHeight + g.tip - 4)).toBe(g.index);
    // The lane above the board is not a tine, even with slack.
    expect(playerTineAt(layout46, width, height, boardFraction, g.cx, laneHeight - 40, 8)).toBeNull();
  });

  it("follows the layout it is given, not any earlier one", () => {
    const seventeen = presetById("standard-17")!;
    const width = 1000;
    const height = 600;
    const boardHeight = Math.round(height * 0.46);
    const geo = computeBoardGeometry(seventeen, width, boardHeight);
    const g = geo.tines[3];
    const y = height - boardHeight + g.tip - 4;
    expect(playerTineAt(seventeen, width, height, 0.46, g.cx, y)).toBe(g.index);
    // Same click, other layout: whatever it lands on belongs to that layout.
    const other = playerTineAt(layout46, width, height, 0.46, g.cx, y);
    if (other !== null) expect(layout46.tines[other]).toBeDefined();
  });
});
