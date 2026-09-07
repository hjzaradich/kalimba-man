import { describe, expect, it } from "vitest";
import { validateLayout } from "./layout";
import {
  addTier,
  addTine,
  blankLayout,
  compactSlots,
  duplicateLayout,
  fillFan,
  fillSemitoneAbove,
  nudgeTine,
  relabelAll,
  removeTier,
  removeTine,
  setTinePitch,
  shiftTier,
} from "./layoutEdit";
import { presetById } from "../presets";

describe("layout editing", () => {
  it("builds the 17-key from a blank layout with one fill", () => {
    const l = fillFan(blankLayout(), 0, 60, 88);
    expect(l.tines.map((t) => t.pitch)).toEqual(presetById("standard-17")!.tines.map((t) => t.pitch));
    expect(validateLayout(l)).toEqual([]);
  });

  it("rebuilds the 46-key from fills alone", () => {
    let l = blankLayout();
    l = addTier(addTier(l)); // three tiers
    l = fillFan(l, 0, 48, 59); // bass naturals, placeholder
    l = fillFan(l, 1, 60, 88);
    l = fillSemitoneAbove(l, 2, 1);
    expect(l.tines.filter((t) => t.layer === 2)).toHaveLength(17);
    const preset = presetById("chill-angels-46")!;
    const sharps = (x: typeof l) => x.tines.filter((t) => t.layer === 2).sort((a, b) => a.x - b.x).map((t) => t.pitch);
    expect(sharps(l)).toEqual(sharps(preset));
    expect(validateLayout(l)).toEqual([]);
  });

  it("adds, moves, relabels and removes tines", () => {
    let l = fillFan(blankLayout(), 0, 60, 64); // C4 D4 E4 → D4 C4 E4
    l = addTine(l, 0, 67);
    expect(l.tines[3]).toMatchObject({ pitch: 67, label: "5", x: 3 });
    l = setTinePitch(l, 3, 61);
    expect(l.tines[3]).toMatchObject({ label: "1#", octaveDots: 0 });
    l = relabelAll(l, "flat");
    expect(l.tines[3].label).toBe("2b");
    expect(l.accidentalStyle).toBe("flat");
    // Nudging into an occupied slot swaps.
    l = nudgeTine(l, 3, -1);
    expect(l.tines[3].x).toBe(2);
    expect(l.tines[2].x).toBe(3);
    expect(nudgeTine(l, 1, -1).tines[1].x).toBe(0); // swap with slot 0
    l = removeTine(l, 3);
    expect(l.tines).toHaveLength(3);
    expect(validateLayout(l)).toEqual([]);
  });

  it("adds and removes tiers, renumbering tines above", () => {
    let l = addTier(addTier(fillFan(blankLayout(), 0, 60, 64)));
    l = addTine(l, 2, 72);
    expect(l.layers).toHaveLength(3);
    l = removeTier(l, 1);
    expect(l.layers).toHaveLength(2);
    expect(l.tines.find((t) => t.pitch === 72)!.layer).toBe(1);
    expect(removeTier(blankLayout(), 0)).toEqual(blankLayout());
  });

  it("shifts and compacts slots", () => {
    let l = fillFan(blankLayout(), 0, 60, 64);
    expect(shiftTier(l, 0, -1)).toBe(l); // would go below 0
    l = shiftTier(l, 0, 2);
    expect(l.tines.map((t) => t.x)).toEqual([2, 3, 4]);
    expect(compactSlots(l).tines.map((t) => t.x)).toEqual([0, 1, 2]);
  });

  it("duplicates a preset into an editable copy", () => {
    const copy = duplicateLayout(presetById("standard-21")!, "Mine");
    expect(copy.id).toBe("");
    expect(copy.name).toBe("Mine");
    expect(copy.tines).toEqual(presetById("standard-21")!.tines);
    expect(copy.tines).not.toBe(presetById("standard-21")!.tines);
  });
});
