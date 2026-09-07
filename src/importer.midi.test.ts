import { describe, expect, it } from "vitest";
import { likelyMelodyTrack, songFromMidiFile, type MidiImport } from "./importer";
import { refitSong, selectTrack } from "./model/fit";
import { coerceSong } from "./model/song";
import { presetById } from "./presets";

const bass = [
  { time: 0, duration: 1, pitch: 48 },
  { time: 1, duration: 1, pitch: 55 },
];
const melody = [
  { time: 0, duration: 0.5, pitch: 74 },
  { time: 0.5, duration: 0.5, pitch: 76 },
  { time: 1, duration: 0.5, pitch: 78 },
];

const twoTracks: MidiImport = {
  bpm: 96,
  timeSignature: [3, 4],
  notes: [...bass, ...melody],
  tracks: [
    { index: 0, name: "Piano LH", notes: bass },
    { index: 2, name: "Melody", notes: melody },
  ],
  track: null,
};

describe("MIDI files with tracks", () => {
  it("guesses the melody as the fullest track, or nothing for a single track", () => {
    expect(likelyMelodyTrack(twoTracks)).toBe(2);
    expect(likelyMelodyTrack({ ...twoTracks, tracks: [twoTracks.tracks![0]] })).toBeUndefined();
  });

  it("keeps every track on the song and plays the likely melody", () => {
    const song = songFromMidiFile(twoTracks, "let_it-be.mid");
    expect(song.title).toBe("let it be");
    expect(song.timing).toBe("measured");
    expect(song.tracks?.map((t) => t.name)).toEqual(["Piano LH", "Melody"]);
    expect(song.activeTrack).toBe(1);
    expect(song.notes).toEqual(melody);
    expect(song.text).toBe("2° 3° 4#°");
    // A single-track file has no track list.
    const single = songFromMidiFile({ ...twoTracks, tracks: [twoTracks.tracks![1]], notes: melody }, "x.mid");
    expect(single.tracks).toBeUndefined();
    expect(single.notes).toEqual(melody);
  });

  it("switches the active track and refits the same way as before", () => {
    const seventeen = presetById("standard-17")!;
    const song = refitSong(songFromMidiFile(twoTracks, "x.mid"), seventeen);
    expect(song.fit).toMatchObject({ auto: true, unplayable: 0 }); // F#5 shifted away
    const switched = selectTrack(song, 0, seventeen);
    expect(switched.activeTrack).toBe(0);
    expect(switched.original!.notes).toEqual(bass);
    expect(switched.fit).toMatchObject({ auto: true, layoutId: "standard-17", unplayable: 0 });
    // C3 and G3 are below a 17-key: folded up an octave.
    expect(switched.notes.map((n) => n.pitch)).toEqual([60, 67]);
    expect(selectTrack(song, 1, seventeen)).toBe(song); // already active
    expect(selectTrack(song, 9, seventeen)).toBe(song); // no such track
  });

  it("round-trips tracks through the song file", () => {
    const song = songFromMidiFile(twoTracks, "x.mid");
    const back = coerceSong(JSON.parse(JSON.stringify(song)))!;
    expect(back.tracks).toEqual(song.tracks);
    expect(back.activeTrack).toBe(1);
  });
});
