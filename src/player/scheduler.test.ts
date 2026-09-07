import { describe, expect, it } from "vitest";
import { parseNotation } from "../model/notation";
import { songFromText } from "../model/song";
import { Scheduler } from "./scheduler";
import type { Synth } from "./synth";
import { Transport } from "./transport";

function setup() {
  let real = 10;
  const transport = new Transport(() => real, 0);
  const plucked: number[] = [];
  const synth = { pluck: (pitch: number) => plucked.push(pitch), click: () => {} } as unknown as Synth;
  // Ten notes, one per second, pitches 60..69.
  const text = "1 2 3 4 5 6 7 1° 2° 3°";
  const song = songFromText(text, { title: "t", bpm: 60 }, parseNotation(text).events);
  const scheduler = new Scheduler(transport, synth, song);
  transport.setDuration(12);
  return { transport, scheduler, plucked, song, advance: (s: number) => (real += s) };
}

describe("Scheduler", () => {
  it("hands notes over just ahead of the clock", () => {
    const { transport, scheduler, plucked, advance } = setup();
    transport.play();
    scheduler.tick();
    expect(plucked).toEqual([60]); // only the note at 0 is within the lookahead
    advance(0.95);
    scheduler.tick();
    expect(plucked).toEqual([60, 62]);
  });

  it("does not blurt out the notes skipped by a forward seek", () => {
    const { transport, scheduler, plucked, advance } = setup();
    transport.play();
    scheduler.tick();
    advance(0.5);
    transport.seek(6.0);
    scheduler.tick();
    // Nothing from 1 s..5 s; only the note at 6 s (within the lookahead).
    expect(plucked).toEqual([60, 71]);
    advance(0.95);
    scheduler.tick();
    expect(plucked).toEqual([60, 71, 72]);
  });

  it("skips notes that are already behind the clock", () => {
    const { transport, scheduler, plucked, advance } = setup();
    transport.seek(2.5);
    transport.play();
    advance(1.2); // a stall: the clock jumps past 3 s and 3.5 s before the first tick
    scheduler.tick();
    expect(plucked).toEqual([]);
  });
});
