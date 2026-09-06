import { describe, expect, it } from "vitest";
import { songFromImport, type ImportResult } from "./importer";

describe("songFromImport", () => {
  it("keeps MIDI timing and writes editable text", () => {
    const r: ImportResult = {
      sourceUrl: "https://www.kalimbatabs.net/x/",
      title: "Song",
      artist: "Band",
      kind: "midi",
      midi: {
        bpm: 90,
        timeSignature: [3, 4],
        notes: [
          { time: 0, duration: 0.5, pitch: 60 },
          { time: 0, duration: 0.5, pitch: 64 },
          { time: 0.667, duration: 0.3, pitch: 79 },
        ],
      },
    };
    const { song, parse } = songFromImport(r);
    expect(parse).toBeNull();
    expect(song.timing).toBe("measured");
    expect(song.bpm).toBe(90);
    expect(song.timeSignature).toEqual([3, 4]);
    expect(song.notes).toHaveLength(3);
    expect(song.text).toBe("(1 3) 5°");
    expect(song.source?.kind).toBe("midi");
  });

  it("parses text imports with uniform timing and honours overrides", () => {
    const r: ImportResult = { sourceUrl: "u", title: "Raw", kind: "text", text: "1 2 3\nla la" };
    const { song, parse } = songFromImport(r, { title: " Better ", bpm: 80 });
    expect(parse?.warnings).toEqual([]);
    expect(song.title).toBe("Better");
    expect(song.timing).toBe("uniform");
    expect(song.bpm).toBe(80);
    expect(song.notes).toHaveLength(3);
    expect(song.sections[0].label).toBe("la la");
  });
});
