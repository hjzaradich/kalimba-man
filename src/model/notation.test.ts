import { describe, expect, it } from "vitest";
import { parseNotation, type NoteEvent } from "./notation";

const C4 = 60;
const notes = (text: string) =>
  parseNotation(text).events.filter((e): e is NoteEvent => e.kind === "note");
const pitches = (text: string) => notes(text).map((n) => n.pitches);

describe("single notes", () => {
  it("reads degrees relative to C4", () => {
    expect(pitches("1 2 3 4 5 6 7")).toEqual([[60], [62], [64], [65], [67], [69], [71]]);
  });

  it("reads octave marks", () => {
    expect(pitches("1° 1°° 1")).toEqual([[72], [84], [60]]);
    expect(pitches("1' 1* 1º 1^")).toEqual([[72], [72], [72], [72]]);
    expect(pitches(".1 ,1 ..1")).toEqual([[48], [48], [36]]);
  });

  it("reads accidentals before or after the digit", () => {
    expect(pitches("1# #1 2b b2 4#°")).toEqual([[61], [61], [61], [61], [78]]);
  });

  it("splits notes run together without spaces", () => {
    // From "Can't Help Falling in Love" on the site.
    expect(pitches("1°5°1°")).toEqual([[72], [79], [72]]);
    expect(pitches("5671°  2°3°4°3°2°1°")).toEqual([[67], [69], [71], [72], [74], [76], [77], [76], [74], [72]]);
  });

  it("reads long-note marks", () => {
    const n = notes("1~ 2~~ 3");
    expect(n.map((x) => x.long)).toEqual([1, 2, 0]);
  });

  it("reads a dot after a digit as an octave mark unless it ends a sentence", () => {
    expect(pitches("1. 1.2")).toEqual([[60], [72], [62]]);
  });
});

describe("chords", () => {
  it("groups bracketed notes into one event", () => {
    expect(pitches("(1 3 5) 5°")).toEqual([[60, 64, 67], [79]]);
    expect(pitches("(135)")).toEqual([[60, 64, 67]]);
    expect(pitches("[1 3]")).toEqual([[60, 64]]);
  });

  it("keeps the site's chord lines intact", () => {
    // From "On Melancholy Hill".
    const p = pitches("1° 5° 1° 5° 1° (2 5 7) 5°");
    expect(p).toEqual([[72], [79], [72], [79], [72], [62, 67, 71], [79]]);
  });

  it("applies a long mark after the bracket to the chord", () => {
    expect(notes("(1 3)~")[0].long).toBe(1);
  });

  it("warns on an unclosed bracket but keeps the notes", () => {
    const r = parseNotation("(1 3 5");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/never closed/);
    expect((r.events[0] as NoteEvent).pitches).toEqual([60, 64, 67]);
  });

  it("warns on an empty or stray bracket", () => {
    expect(parseNotation("() 1").warnings[0].message).toMatch(/Empty chord/);
    expect(parseNotation("1 )").warnings[0].message).toMatch(/no opening/);
  });
});

describe("rests, breaks and text", () => {
  it("reads standalone dashes as rests", () => {
    const kinds = parseNotation("1 - 2 _ 3").events.map((e) => e.kind);
    expect(kinds).toEqual(["note", "rest", "note", "rest", "note"]);
  });

  it("treats lines with words as lyrics and #X lines as sections", () => {
    const text = `#A
1°5°1°
Wise men say
2°3°4°3°2°
Only fools rush in`;
    const events = parseNotation(text).events;
    expect(events.map((e) => e.kind)).toEqual(["text", "note", "note", "note", "text", "note", "note", "note", "note", "note", "text"]);
    expect(events[0]).toMatchObject({ kind: "text", section: true, text: "A" });
    expect(events[4]).toMatchObject({ kind: "text", section: false, text: "Wise men say" });
  });

  it("inserts a break for a blank line between note lines, but not before the first", () => {
    const text = `

1 2

3 4
`;
    const kinds = parseNotation(text).events.map((e) => e.kind);
    expect(kinds).toEqual(["note", "note", "break", "note", "note"]);
  });

  it("does not mistake a lyric containing digits for notes", () => {
    const events = parseNotation("2 become 1").events;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("text");
  });

  it("ignores bar lines and slashes", () => {
    expect(pitches("1 | 2 / 3")).toEqual([[60], [62], [64]]);
  });
});

describe("warnings", () => {
  it("flags digits outside 1–7 with their position", () => {
    const r = parseNotation("1 8 2");
    expect(r.warnings).toEqual([{ line: 1, col: 3, message: '"8" is not a note; digits must be 1–7.' }]);
    expect(pitches("1 8 2")).toEqual([[60], [62]]);
  });

  it("flags unknown symbols once per run", () => {
    const r = parseNotation("1 ?? 2");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/Could not read "\?\?"/);
  });
});

describe("key offset", () => {
  it("shifts every pitch", () => {
    expect(parseNotation("1 5", 7).events.map((e) => (e as NoteEvent).pitches)).toEqual([[67], [74]]);
  });
});

describe("real posts", () => {
  it("parses the whole of Can't Help Falling in Love without warnings", () => {
    const text = `#A
1°5°1°
Wise men say
2°3°4°3°2°
Only fools rush in
5671°  2°3°4°3°2°1°
But I can't help falling in love with you
#B
7 3°5°7°6°
Like a river flows
7 3°5°7°6°
Surely to the sea
5°5° 3°5°3° 4°
Some things are meant to be`;
    const r = parseNotation(text);
    expect(r.warnings).toEqual([]);
    // 3 + 5 + 10 + 5 + 5 + 6 notes across the six note lines.
    expect(r.events.filter((e) => e.kind === "note")).toHaveLength(34);
    expect(r.events.filter((e) => e.kind === "text" && e.section)).toHaveLength(2);
  });

  it("parses the MIDI-era text export without warnings", () => {
    const text = `(1 3 5 1°) 5°
1° 5° 1° 5° 1° (2 5 7) 5°
7 5° 7 5° (3 6 1°) 5°
3° (4 6 1° 3°) 5° 4° 3° 2° 1° (2 5) 5 5 5 6 1° (4 6 1°)`;
    const r = parseNotation(text);
    expect(r.warnings).toEqual([]);
    const chords = notes(text).filter((n) => n.pitches.length > 1);
    expect(chords).toHaveLength(6);
    expect(chords[0].pitches).toEqual([60, 64, 67, 72]);
  });

  it("does not choke on the site's copy footer", () => {
    const text = `1 2 3

Source: On Melancholy Hill Kalimba Tabs (https://www.kalimbatabs.net/...)`;
    const r = parseNotation(text);
    expect(r.warnings).toEqual([]);
    expect(pitches(text)).toEqual([[60], [62], [64]]);
  });
});

expect(C4).toBe(60);
