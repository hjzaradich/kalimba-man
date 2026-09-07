import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { concatSections, convertSection, hookpadPitch, parseHookpad, secondsAtBeat, voices } from "./hookpad";

const FIXTURES = join(__dirname, "..", "..", "src-tauri", "fixtures");
const load = (name: string) => parseHookpad(JSON.parse(readFileSync(join(FIXTURES, name), "utf8")).jsonData as string);

describe("hookpadPitch", () => {
  it("places octave 0 on the tonic in MIDI octave 4", () => {
    expect(hookpadPitch("1", 0, "C", "major")).toBe(60);
    expect(hookpadPitch("1", 1, "D", "major")).toBe(74); // D5
    expect(hookpadPitch("7", 0, "D", "major")).toBe(73); // C#5, as the site's range shows
    expect(hookpadPitch("5", 1, "D", "major")).toBe(81); // A5
  });

  it("follows the mode and accidentals", () => {
    expect(hookpadPitch("3", 0, "A", "minor")).toBe(72); // C5
    expect(hookpadPitch("b7", 0, "C", "major")).toBe(70);
    expect(hookpadPitch("#4", 0, "C", "major")).toBe(66);
    expect(hookpadPitch("1", 0, "Bb", "major")).toBe(70);
    expect(hookpadPitch("1", 0, "F#", "dorian")).toBe(66);
  });
});

describe("secondsAtBeat", () => {
  it("uses the tempo map", () => {
    const doc = { tempos: [{ beat: 1, bpm: 120 }, { beat: 5, bpm: 60 }] };
    expect(secondsAtBeat(doc, 1)).toBe(0);
    expect(secondsAtBeat(doc, 5)).toBe(2);
    expect(secondsAtBeat(doc, 7)).toBe(4);
  });
});

describe("real documents", () => {
  it("converts On Melancholy Hill with its rhythm intact", () => {
    const doc = load("theorytab-melancholy-yvgPXXajBgY.json");
    expect(voices(doc)).toHaveLength(1);
    const s = convertSection(doc);
    expect(s.tonic).toBe("D");
    expect(s.bpm).toBe(120);
    expect(s.timeSignature).toEqual([4, 4]);
    // 46 entries in the file, some of them rests.
    expect(s.notes.length).toBeGreaterThan(30);
    expect(s.notes.length).toBeLessThan(46);
    // First note: sd 1 octave 1 at beat 41 → D5 at 20 s, one beat long.
    expect(s.notes[0]).toEqual({ time: 20, duration: 0.5, pitch: 74 });
    // Range C#5–A5 as the site reports.
    const pitches = s.notes.map((n) => n.pitch);
    expect(Math.min(...pitches)).toBe(73);
    expect(Math.max(...pitches)).toBe(81);
    expect(s.duration).toBe(40); // endBeat 81 at 120 BPM
    expect(s.chords.length).toBeGreaterThan(5);
    expect(s.chords[0]).toMatchObject({ time: 0, duration: 4, pitches: [50, 54, 57] }); // I in D: D3 F#3 A3
  });

  it("concatenates Let It Be's three sections with markers", () => {
    const names = ["Verse", "Chorus", "Bridge"];
    const ids = ["_NgbRXeYgQA", "nvgyBpArxkA", "yvgPv-kKoYq"];
    const parts = ids.map((id, i) => ({ name: names[i], section: convertSection(load(`theorytab-let-it-be-${id}.json`)) }));
    const out = concatSections(parts);
    expect(out.sections.map((s) => s.label)).toEqual(names);
    expect(out.sections[0].time).toBe(0);
    expect(out.sections[1].time).toBeCloseTo(parts[0].section.duration, 3);
    expect(out.sections[2].time).toBeCloseTo(parts[0].section.duration + parts[1].section.duration, 3);
    // Notes are in time order across the seams and the bridge's b7 is a Bb.
    const times = out.notes.map((n) => n.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(out.notes.some((n) => n.pitch % 12 === 10)).toBe(true);
    expect(out.notes.length).toBeGreaterThan(50);
  });
});
