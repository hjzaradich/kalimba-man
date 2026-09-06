import { describe, expect, it } from "vitest";
import { parseNotation } from "./notation";
import { coerceSong, notesFromEvents, slugify, songDuration, songFromText, transpose, withBpm } from "./song";

describe("uniform timing", () => {
  it("gives each note one beat and chords one beat shared", () => {
    const { notes } = notesFromEvents(parseNotation("1 (3 5) 1°").events, { bpm: 120, gate: 1 });
    expect(notes.map((n) => [n.time, n.duration, n.pitch, n.chord ?? null])).toEqual([
      [0, 0.5, 60, null],
      [0.5, 0.5, 64, 1],
      [0.5, 0.5, 67, 1],
      [1, 0.5, 72, null],
    ]);
  });

  it("doubles for each long mark and adds rests and breaks", () => {
    const text = `1~ - 2~~

3`;
    const { notes } = notesFromEvents(parseNotation(text).events, { bpm: 60, gate: 1, breakBeats: 0.5 });
    expect(notes.map((n) => n.time)).toEqual([0, 3, 7.5]);
    expect(notes.map((n) => n.duration)).toEqual([2, 4, 1]);
  });

  it("places lyric and section lines at the time of the next note", () => {
    const text = `#A
1 2
Wise men say
3`;
    const { sections } = notesFromEvents(parseNotation(text).events, { bpm: 60 });
    expect(sections).toEqual([
      { time: 0, label: "A", marker: true },
      { time: 2, label: "Wise men say", marker: false },
    ]);
  });

  it("applies the gate so consecutive notes do not touch", () => {
    const { notes } = notesFromEvents(parseNotation("1 2").events, { bpm: 60, gate: 0.9 });
    expect(notes[0].duration).toBeCloseTo(0.9);
    expect(notes[1].time).toBe(1);
  });
});

describe("song helpers", () => {
  const song = songFromText("1 2 3", { title: "Test", bpm: 60 }, parseNotation("1 2 3").events);

  it("builds a complete song from text", () => {
    expect(song.timing).toBe("uniform");
    expect(song.notes).toHaveLength(3);
    expect(song.text).toBe("1 2 3");
    expect(songDuration(song)).toBeCloseTo(2.9);
  });

  it("rescales to a new bpm keeping beat positions", () => {
    const faster = withBpm(song, 120);
    expect(faster.notes.map((n) => n.time)).toEqual([0, 0.5, 1]);
    expect(faster.notes[0].duration).toBeCloseTo(0.45);
    expect(faster.bpm).toBe(120);
  });

  it("transposes pitches only", () => {
    expect(transpose(song, 2).notes.map((n) => n.pitch)).toEqual([62, 64, 66]);
    expect(transpose(song, 0)).toBe(song);
  });

  it("slugifies titles", () => {
    expect(slugify("Can't Help Falling in Love")).toBe("can-t-help-falling-in-love");
    expect(slugify("  ")).toBe("untitled");
    expect(slugify("Howl's Moving Castle (Merry-Go-Round)")).toBe("howl-s-moving-castle-merry-go-round");
  });

  it("coerces a JSON object back into a song and rejects junk", () => {
    const back = coerceSong(JSON.parse(JSON.stringify(song)));
    expect(back).toEqual(song);
    expect(coerceSong(null)).toBeNull();
    expect(coerceSong({ version: 2, title: "x", notes: [] })).toBeNull();
    expect(coerceSong({ version: 1, title: "x", notes: [{ time: "a" }] })).toBeNull();
    // Missing optional fields get defaults.
    const minimal = coerceSong({ version: 1, title: "m", notes: [] })!;
    expect(minimal.bpm).toBe(100);
    expect(minimal.timing).toBe("uniform");
    expect(minimal.sections).toEqual([]);
  });
});
