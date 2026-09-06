import { describe, expect, it } from "vitest";
import { parseNotation, type NoteEvent } from "./notation";
import { notationFromNotes, tokenForPitch } from "./notationOut";
import { songFromText } from "./song";

describe("tokenForPitch", () => {
  it("writes degrees, octaves and sharps the way the site does", () => {
    expect(tokenForPitch(60)).toBe("1");
    expect(tokenForPitch(72)).toBe("1°");
    expect(tokenForPitch(86)).toBe("2°°");
    expect(tokenForPitch(48)).toBe(".1");
    expect(tokenForPitch(61)).toBe("1#");
    expect(tokenForPitch(78)).toBe("4#°");
  });

  it("round-trips through the parser", () => {
    for (let p = 40; p <= 96; p++) {
      const events = parseNotation(tokenForPitch(p)).events as NoteEvent[];
      expect(events[0].pitches).toEqual([p]);
    }
  });
});

describe("notationFromNotes", () => {
  it("groups chords and breaks lines per measure", () => {
    const text = "1 (3 5) 1° 2° 3 4 5 6";
    const song = songFromText(text, { title: "t", bpm: 120 }, parseNotation(text).events);
    // 120 BPM, 4/4: a measure is four beats, i.e. four events.
    expect(notationFromNotes(song)).toBe("1 (3 5) 1° 2°\n3 4 5 6");
  });

  it("re-parses to the same pitches", () => {
    const text = "1°5°1° (2 5 7) .7 4#";
    const song = songFromText(text, { title: "t" }, parseNotation(text).events);
    const again = parseNotation(notationFromNotes(song)).events as NoteEvent[];
    expect(again.flatMap((e) => e.pitches)).toEqual(song.notes.map((n) => n.pitch));
  });

  it("handles an empty song", () => {
    expect(notationFromNotes({ notes: [], bpm: 100, timeSignature: [4, 4] })).toBe("");
  });
});
