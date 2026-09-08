import { describe, expect, it } from "vitest";
import { Detector } from "./detector";
import { presetById } from "../presets";
import { click, noise, pluck, run, silence } from "./testSignals";

const FS = 48000;
const k46 = presetById("chill-angels-46")!;
const k17 = presetById("standard-17")!;

/** Onset must land within this of the true pluck, in seconds (DESIGN.md §16.10). */
const TIMING = 0.015;

function detect(layout = k46, opts: Partial<ConstructorParameters<typeof Detector>[1]> = {}) {
  return new Detector(layout, { sampleRate: FS, ...opts });
}

function scene(seconds: number, build: (s: Float32Array) => void, noiseAmp = 0.002): Float32Array {
  const s = silence(seconds, FS);
  build(s);
  noise(s, noiseAmp);
  return s;
}

describe("Detector", () => {
  it("hears a single note on the right tine at the right time", () => {
    const hits = run(detect(), scene(1.5, (s) => pluck(s, FS, 0.5, 60)), FS);
    expect(hits.map((h) => h.pitch)).toEqual([60]);
    expect(Math.abs(hits[0].time - 0.5)).toBeLessThan(TIMING);
    expect(hits[0].tines).toEqual(k46.tines.map((t, i) => (t.pitch === 60 ? i : -1)).filter((i) => i >= 0));
    expect(Math.abs(hits[0].cents)).toBeLessThan(10);
  });

  it("hears every note of a chord with one onset", () => {
    const hits = run(
      detect(),
      scene(1.5, (s) => {
        pluck(s, FS, 0.5, 60);
        pluck(s, FS, 0.5, 64);
        pluck(s, FS, 0.5, 67);
      }),
      FS,
    );
    expect(hits.map((h) => h.pitch).sort((a, b) => a - b)).toEqual([60, 64, 67]);
    for (const h of hits) expect(Math.abs(h.time - 0.5)).toBeLessThan(TIMING);
  });

  it("hears an arpeggio over a ringing note", () => {
    const hits = run(
      detect(),
      scene(2, (s) => {
        pluck(s, FS, 0.3, 60);
        pluck(s, FS, 0.6, 64);
        pluck(s, FS, 0.9, 67);
      }),
      FS,
    );
    expect(hits.map((h) => h.pitch)).toEqual([60, 64, 67]);
    [0.3, 0.6, 0.9].forEach((t, i) => expect(Math.abs(hits[i].time - t)).toBeLessThan(TIMING));
  });

  it("tells the bass row's semitones apart while the first still rings", () => {
    const hits = run(
      detect(),
      scene(2, (s) => {
        pluck(s, FS, 0.3, 48);
        pluck(s, FS, 0.8, 49);
      }),
      FS,
    );
    expect(hits.map((h) => h.pitch)).toEqual([48, 49]);
    for (const h of hits) expect(Math.abs(h.cents)).toBeLessThan(20);
  });

  it("hears a quick repeat of the same note", () => {
    const hits = run(
      detect(),
      scene(1.5, (s) => {
        pluck(s, FS, 0.3, 65, 0.3, 1.5, 0, 0.45); // damped by the thumb that re-plucks it
        pluck(s, FS, 0.45, 65);
      }),
      FS,
    );
    expect(hits.map((h) => h.pitch)).toEqual([65, 65]);
    expect(Math.abs(hits[1].time - 0.45)).toBeLessThan(TIMING);
  });

  it("does not hear a low note's overtone as a high note", () => {
    // C3's 6.27× overtone is 22 cents from G♯5, which the 46-key has.
    const hits = run(detect(), scene(1.5, (s) => pluck(s, FS, 0.4, 48, 0.5)), FS);
    expect(hits.map((h) => h.pitch)).toEqual([48]);
  });

  it("ignores the metronome click, silence and noise", () => {
    const clicks = run(
      detect(),
      scene(2, (s) => {
        for (let t = 0.2; t < 2; t += 0.5) click(s, FS, t);
      }),
      FS,
    );
    expect(clicks).toEqual([]);
    expect(run(detect(), scene(1.5, () => {}), FS)).toEqual([]);
    expect(run(detect(), scene(1.5, () => {}, 0.01), FS)).toEqual([]);
  });

  it("ignores pitches the layout does not have", () => {
    const hits = run(
      detect(k17),
      scene(1.5, (s) => {
        pluck(s, FS, 0.3, 66); // F♯4: not on a 17-key
        pluck(s, FS, 0.8, 60);
      }),
      FS,
    );
    expect(hits.map((h) => h.pitch)).toEqual([60]);
  });

  it("reports how far off a tine is, and follows a tuning offset", () => {
    const flat = run(detect(), scene(1.5, (s) => pluck(s, FS, 0.5, 60, 0.3, 1.5, -25)), FS);
    expect(flat.map((h) => h.pitch)).toEqual([60]);
    expect(flat[0].cents).toBeGreaterThan(-35);
    expect(flat[0].cents).toBeLessThan(-15);

    const veryFlat = scene(1.5, (s) => pluck(s, FS, 0.5, 60, 0.3, 1.5, -60));
    expect(run(detect(), veryFlat, FS)).toEqual([]);
    const tuned = run(detect(k46, { tuningCents: -60 }), veryFlat, FS);
    expect(tuned.map((h) => h.pitch)).toEqual([60]);
  });

  it("hears a quiet pluck and a loud one", () => {
    const quiet = run(detect(), scene(1.5, (s) => pluck(s, FS, 0.5, 72, 0.03)), FS);
    expect(quiet.map((h) => h.pitch)).toEqual([72]);
    const loud = run(detect(), scene(1.5, (s) => pluck(s, FS, 0.5, 72, 0.9)), FS);
    expect(loud.map((h) => h.pitch)).toEqual([72]);
    expect(loud[0].strength).toBeGreaterThan(0.5);
  });
});
