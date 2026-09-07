import { describe, expect, it } from "vitest";
import { likelyMelodyTrack, songFromMidiFile, type MidiImport } from "./importer";

const twoTracks: MidiImport = {
  bpm: 96,
  timeSignature: [3, 4],
  notes: [
    { time: 0, duration: 0.5, pitch: 67 },
    { time: 0.625, duration: 0.5, pitch: 69 },
  ],
  tracks: [
    { index: 0, name: "Piano LH", notes: 40 },
    { index: 1, name: "Melody", notes: 120 },
  ],
  track: 1,
};

describe("MIDI files", () => {
  it("guesses the melody as the fullest track, or nothing for a single track", () => {
    expect(likelyMelodyTrack(twoTracks)).toBe(1);
    expect(likelyMelodyTrack({ ...twoTracks, tracks: [twoTracks.tracks![0]] })).toBeUndefined();
    expect(likelyMelodyTrack({ ...twoTracks, tracks: undefined })).toBeUndefined();
  });

  it("builds a measured song titled from the file name", () => {
    const song = songFromMidiFile(twoTracks, "let_it-be.mid");
    expect(song.title).toBe("let it be");
    expect(song.timing).toBe("measured");
    expect(song.bpm).toBe(96);
    expect(song.timeSignature).toEqual([3, 4]);
    expect(song.source).toMatchObject({ kind: "midi", url: "file:let_it-be.mid" });
    expect(song.notes).toEqual([
      { time: 0, duration: 0.5, pitch: 67 },
      { time: 0.625, duration: 0.5, pitch: 69 },
    ]);
    expect(song.text).toBe("5 6");
    expect(songFromMidiFile(twoTracks, "x.mid", { title: "Given", artist: "Someone" })).toMatchObject({ title: "Given", artist: "Someone" });
  });
});
