import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { songFromTheoryTab, type TheoryTabImport } from "./importer";
import { parseNotation, type NoteEvent } from "./model/notation";
import { presetById } from "./presets";

const FIXTURES = join(__dirname, "..", "src-tauri", "fixtures");
const section = (file: string, id: string, name: string) => ({
  id,
  name,
  jsonData: JSON.parse(readFileSync(join(FIXTURES, file), "utf8")).jsonData as string,
});

const melancholy: TheoryTabImport = {
  sourceUrl: "https://www.hooktheory.com/theorytab/view/gorillaz/on-melancholy-hill",
  title: "On Melancholy Hill",
  artist: "Gorillaz",
  sections: [section("theorytab-melancholy-yvgPXXajBgY.json", "yvgPXXajBgY", "Intro")],
  failed: [],
};

const letItBe: TheoryTabImport = {
  sourceUrl: "https://www.hooktheory.com/theorytab/view/the-beatles/let-it-be",
  title: "Let It Be",
  artist: "The Beatles",
  sections: [
    section("theorytab-let-it-be-_NgbRXeYgQA.json", "_NgbRXeYgQA", "Verse"),
    section("theorytab-let-it-be-nvgyBpArxkA.json", "nvgyBpArxkA", "Chorus"),
    section("theorytab-let-it-be-yvgPv-kKoYq.json", "yvgPv-kKoYq", "Bridge"),
  ],
  failed: [],
};

describe("songFromTheoryTab", () => {
  const seventeen = presetById("standard-17")!;
  const chromatic = presetById("chill-angels-46")!;

  it("lands On Melancholy Hill on the 46-key untouched, and on the 17-key with the smallest shift", () => {
    const big = songFromTheoryTab(melancholy, chromatic);
    expect(big.key).toBe("D major");
    expect(big.fit).toMatchObject({ shift: 0, folded: 0, unplayable: 0 });
    expect(big.song.timing).toBe("measured");
    expect(big.song.source?.kind).toBe("theorytab");
    expect(big.song.bpm).toBe(120);
    expect(big.song.chords?.length).toBeGreaterThan(5);

    const small = songFromTheoryTab(melancholy, seventeen);
    // The melody is C#5–A5 in D major; C# is off a C-major kalimba, so the
    // best fit is a 2-semitone shift (to C or E), with nothing folded.
    expect(small.fit.unplayable).toBe(0);
    expect(small.fit.folded).toBe(0);
    expect(Math.abs(small.fit.semitones)).toBe(2);
    expect(small.song.about).toMatch(/From TheoryTab in D major; (up|down) 2 semitones/);
  });

  it("stitches Let It Be's sections in order and writes a readable tab", () => {
    const b = songFromTheoryTab(letItBe, chromatic);
    expect(b.song.sections.map((s) => s.label)).toEqual(["Verse", "Chorus", "Bridge"]);
    expect(b.fit.unplayable).toBe(0);
    expect(b.song.notes.length).toBeGreaterThan(50);
    // The generated text re-parses to the same pitches.
    const again = parseNotation(b.song.text!).events.filter((e): e is NoteEvent => e.kind === "note").flatMap((e) => e.pitches);
    expect(again).toEqual(b.song.notes.map((n) => n.pitch));
  });

  it("honours section selection, voice and a fit override", () => {
    const chorusOnly = songFromTheoryTab(letItBe, chromatic, { sectionIds: ["nvgyBpArxkA"] });
    expect(chorusOnly.song.sections.map((s) => s.label)).toEqual(["Chorus"]);
    expect(chorusOnly.song.notes.length).toBeLessThan(35);

    const forced = songFromTheoryTab(melancholy, chromatic, { fit: { semitones: 3, octaves: -1 } });
    expect(forced.fit.shift).toBe(-9);
    expect(forced.song.notes[0].pitch).toBe(74 - 9);
    expect(forced.song.chords![0].pitches).toEqual([50 - 9, 54 - 9, 57 - 9]);
    expect(forced.voiceCount).toBe(1);
  });
});
