import { describe, expect, it } from "vitest";
import { Transport } from "./transport";

function fakeClock() {
  let t = 100;
  return { now: () => t, advance: (s: number) => (t += s) };
}

describe("Transport", () => {
  it("starts with a lead-in of silence when playing from the top", () => {
    const c = fakeClock();
    const tr = new Transport(c.now); // default lead-in of 3 s
    tr.setDuration(10);
    tr.play();
    expect(tr.now()).toBe(-3);
    c.advance(3);
    expect(tr.now()).toBeCloseTo(0);
    // The lead-in is not repeated after a seek into the song.
    tr.pause();
    tr.seek(4);
    tr.play();
    expect(tr.now()).toBe(4);
    // Seeking back to 0 and playing gets the lead-in again.
    tr.pause();
    tr.seek(0);
    tr.play();
    expect(tr.now()).toBe(-3);
  });

  it("advances song time at the playback rate while playing", () => {
    const c = fakeClock();
    const tr = new Transport(c.now, 0);
    tr.setDuration(10);
    expect(tr.now()).toBe(0);
    tr.play();
    c.advance(2);
    expect(tr.now()).toBeCloseTo(2);
    tr.setRate(0.5);
    c.advance(2);
    expect(tr.now()).toBeCloseTo(3);
    tr.pause();
    c.advance(5);
    expect(tr.now()).toBeCloseTo(3);
  });

  it("stops at the end and restarts from the top", () => {
    const c = fakeClock();
    const tr = new Transport(c.now, 0);
    tr.setDuration(3);
    tr.play();
    c.advance(5);
    tr.tick();
    expect(tr.isPlaying).toBe(false);
    expect(tr.now()).toBe(3);
    tr.play();
    expect(tr.now()).toBe(0);
  });

  it("wraps a loop region and keeps playing", () => {
    const c = fakeClock();
    const tr = new Transport(c.now, 0);
    tr.setDuration(10);
    expect(tr.setLoop(6, 2)).toBe(true); // order does not matter
    expect(tr.loop).toEqual({ a: 2, b: 6 });
    tr.seek(5.5);
    tr.play();
    c.advance(0.55);
    tr.tick();
    expect(tr.isPlaying).toBe(true);
    expect(tr.now()).toBeCloseTo(2.05, 5);
    tr.clearLoop();
    expect(tr.loop).toBeNull();
  });

  it("rejects loops that are too short and clears them on a new song", () => {
    const tr = new Transport(fakeClock().now, 0);
    tr.setDuration(10);
    expect(tr.setLoop(4, 4.1)).toBe(false);
    expect(tr.loop).toBeNull();
    tr.setLoop(1, 3);
    tr.setDuration(20);
    expect(tr.loop).toBeNull();
  });

  it("maps song time to real time for scheduling", () => {
    const c = fakeClock();
    const tr = new Transport(c.now, 0);
    tr.setDuration(10);
    tr.seek(1);
    tr.setRate(2);
    tr.play();
    // Song time 3 is one real second after play at rate 2.
    expect(tr.realTimeFor(3)).toBeCloseTo(101);
  });

  it("notifies listeners on state changes only", () => {
    const c = fakeClock();
    const tr = new Transport(c.now, 0);
    let n = 0;
    tr.subscribe(() => n++);
    tr.setDuration(5);
    tr.play();
    c.advance(1);
    tr.tick();
    tr.seek(2);
    tr.pause();
    expect(n).toBe(4);
  });
});
