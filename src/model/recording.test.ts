import { describe, expect, it } from "vitest";
import { parseNotation } from "./notation";
import { applyRecordedTiming, groupAtOrAfter, groupNotes } from "./recording";
import { songFromText } from "./song";

const mk = (text: string, bpm = 60) => songFromText(text, { title: "t", bpm }, parseNotation(text).events);

describe("groupNotes", () => {
  it("makes one group per note and one per chord, in time order", () => {
    const song = mk("1 (3 5) 1°");
    const groups = groupNotes(song.notes);
    expect(groups.map((g) => g.notes)).toEqual([[0], [1, 2], [3]]);
    expect(groups.map((g) => g.time)).toEqual([0, 1, 2]);
  });

  it("finds the first group at or after a time", () => {
    const groups = groupNotes(mk("1 2 3 4").notes);
    expect(groupAtOrAfter(groups, 0)).toBe(0);
    expect(groupAtOrAfter(groups, 1)).toBe(1);
    expect(groupAtOrAfter(groups, 1.5)).toBe(2);
    expect(groupAtOrAfter(groups, 99)).toBe(4);
  });
});

describe("applyRecordedTiming", () => {
  it("re-times from taps, quantized to sixteenths at the song's bpm", () => {
    const song = mk("1 2 3 4", 120); // beat 0.5s, grid 0.125s
    const groups = groupNotes(song.notes);
    // Taps at 10.0, 10.52, 11.0, 11.26 on some clock.
    const out = applyRecordedTiming(song, groups, [10, 10.52, 11.0, 11.26]);
    expect(out.timing).toBe("recorded");
    expect(out.notes.map((n) => n.time)).toEqual([0, 0.5, 1, 1.25]);
    // Durations follow the gap to the next group; the last gets a beat.
    expect(out.notes.map((n) => n.duration)).toEqual([0.45, 0.45, 0.225, 0.45]);
    // The original is untouched.
    expect(song.notes[1].time).toBe(0.5);
  });

  it("never lets two groups share a slot", () => {
    const song = mk("1 2 3", 60); // grid 0.25s
    const out = applyRecordedTiming(song, groupNotes(song.notes), [0, 0.05, 0.1]);
    expect(out.notes.map((n) => n.time)).toEqual([0, 0.25, 0.5]);
  });

  it("keeps chord members together and moves sections with their notes", () => {
    const text = `#A
1 (3 5)
la la
1°`;
    const song = mk(text, 60);
    const groups = groupNotes(song.notes);
    const out = applyRecordedTiming(song, groups, [5, 7, 7.5]);
    expect(out.notes.map((n) => n.time)).toEqual([0, 2, 2, 2.5]);
    expect(out.sections.map((s) => [s.label, s.time])).toEqual([
      ["A", 0],
      ["la la", 2.5],
    ]);
  });

  it("refuses a tap count that does not match", () => {
    const song = mk("1 2 3");
    expect(() => applyRecordedTiming(song, groupNotes(song.notes), [0, 1])).toThrow(/2 taps for 3 groups/);
  });
});
