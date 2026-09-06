//! A small, tolerant Standard MIDI File reader.
//!
//! The MIDI files kalimbatabs.net generates are slightly malformed (data
//! bytes with the top bit set), which strict parsers reject and lenient ones
//! silently truncate part-way through the song. This reader keeps going: data
//! bytes are masked to seven bits, unknown status bytes are skipped, and a
//! damaged track yields the events read so far rather than nothing.

#[derive(Debug, Clone, PartialEq)]
pub enum EventKind {
    Tempo(u32),
    TimeSignature(u8, u8),
    NoteOn { channel: u8, key: u8, velocity: u8 },
    NoteOff { channel: u8, key: u8 },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// Absolute tick within the track.
    pub tick: u64,
    pub kind: EventKind,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Smf {
    /// Ticks per quarter note. For SMPTE files this is ticks per second and
    /// the default tempo of one "beat" per second makes the maths work.
    pub ticks_per_beat: f64,
    pub smpte: bool,
    pub tracks: Vec<Vec<Event>>,
    /// Tracks that ended early because of bytes the reader could not follow.
    pub damaged_tracks: usize,
}

pub fn parse(bytes: &[u8]) -> Result<Smf, String> {
    if bytes.len() < 14 || &bytes[0..4] != b"MThd" {
        return Err("not a MIDI file (no MThd header)".into());
    }
    let header_len = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let n_tracks = u16::from_be_bytes([bytes[10], bytes[11]]) as usize;
    let division = u16::from_be_bytes([bytes[12], bytes[13]]);
    let (ticks_per_beat, smpte) = if division & 0x8000 != 0 {
        let fps = (-((division >> 8) as i8)) as f64;
        let per_frame = (division & 0xFF) as f64;
        (fps * per_frame, true)
    } else {
        (division.max(1) as f64, false)
    };

    let mut pos = 8 + header_len;
    let mut tracks = Vec::new();
    let mut damaged_tracks = 0;
    for _ in 0..n_tracks {
        if pos + 8 > bytes.len() {
            break;
        }
        if &bytes[pos..pos + 4] != b"MTrk" {
            // Skip unknown chunks.
            let len = u32::from_be_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
            pos += 8 + len;
            continue;
        }
        let len = u32::from_be_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let start = pos + 8;
        let end = (start + len).min(bytes.len());
        let (events, clean) = parse_track(&bytes[start..end]);
        if !clean {
            damaged_tracks += 1;
        }
        tracks.push(events);
        pos = end;
    }
    if tracks.is_empty() {
        return Err("the MIDI file has no tracks".into());
    }
    Ok(Smf { ticks_per_beat, smpte, tracks, damaged_tracks })
}

/// Returns the events and whether the whole track was read cleanly.
fn parse_track(data: &[u8]) -> (Vec<Event>, bool) {
    let mut events = Vec::new();
    let mut i = 0usize;
    let mut tick = 0u64;
    let mut running: Option<u8> = None;

    while i < data.len() {
        let Some((delta, next)) = vlq(data, i) else { return (events, false) };
        i = next;
        tick += delta as u64;
        if i >= data.len() {
            return (events, false);
        }
        let first = data[i];

        // Meta event.
        if first == 0xFF {
            if i + 1 >= data.len() {
                return (events, false);
            }
            let kind = data[i + 1];
            let Some((len, next)) = vlq(data, i + 2) else { return (events, false) };
            let body_end = next + len as usize;
            if body_end > data.len() {
                return (events, false);
            }
            let body = &data[next..body_end];
            match kind {
                0x51 if body.len() >= 3 => events.push(Event {
                    tick,
                    kind: EventKind::Tempo(u32::from_be_bytes([0, body[0], body[1], body[2]])),
                }),
                0x58 if body.len() >= 2 => events.push(Event {
                    tick,
                    kind: EventKind::TimeSignature(body[0], 1u8.checked_shl(body[1] as u32).unwrap_or(4)),
                }),
                0x2F => return (events, true), // end of track
                _ => {}
            }
            i = body_end;
            continue;
        }

        // Sysex: skip.
        if first == 0xF0 || first == 0xF7 {
            let Some((len, next)) = vlq(data, i + 1) else { return (events, false) };
            i = next + len as usize;
            continue;
        }

        // Channel message, possibly with running status.
        let status = if first & 0x80 != 0 {
            i += 1;
            if first >= 0xF0 {
                // System common/realtime: no running status, skip its data.
                i += match first {
                    0xF1 | 0xF3 => 1,
                    0xF2 => 2,
                    _ => 0,
                };
                continue;
            }
            running = Some(first);
            first
        } else {
            match running {
                Some(s) => s,
                None => return (events, false),
            }
        };

        let data_len = match status & 0xF0 {
            0xC0 | 0xD0 => 1,
            _ => 2,
        };
        if i + data_len > data.len() {
            return (events, false);
        }
        let channel = status & 0x0F;
        let d1 = data[i] & 0x7F;
        let d2 = if data_len == 2 { data[i + 1] & 0x7F } else { 0 };
        i += data_len;

        match status & 0xF0 {
            0x90 if d2 > 0 => events.push(Event { tick, kind: EventKind::NoteOn { channel, key: d1, velocity: d2 } }),
            0x90 | 0x80 => events.push(Event { tick, kind: EventKind::NoteOff { channel, key: d1 } }),
            _ => {}
        }
    }
    (events, true)
}

/// Variable-length quantity at `i`: (value, index after it).
fn vlq(data: &[u8], mut i: usize) -> Option<(u32, usize)> {
    let mut value: u32 = 0;
    for _ in 0..4 {
        let b = *data.get(i)?;
        i += 1;
        value = (value << 7) | (b & 0x7F) as u32;
        if b & 0x80 == 0 {
            return Some((value, i));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIDI: &[u8] = include_bytes!("../fixtures/on-melancholy-hill.mid");

    #[test]
    fn reads_the_whole_site_midi() {
        let smf = parse(MIDI).unwrap();
        assert_eq!(smf.ticks_per_beat, 384.0);
        assert!(!smf.smpte);
        assert_eq!(smf.tracks.len(), 1);
        let t = &smf.tracks[0];
        let ons = t.iter().filter(|e| matches!(e.kind, EventKind::NoteOn { .. })).count();
        let offs = t.iter().filter(|e| matches!(e.kind, EventKind::NoteOff { .. })).count();
        assert_eq!((ons, offs), (150, 150));
        assert_eq!(t.last().unwrap().tick, 47615);
        assert!(t.iter().any(|e| e.kind == EventKind::Tempo(500_000)));
        assert!(t.iter().any(|e| e.kind == EventKind::TimeSignature(4, 4)));
    }

    #[test]
    fn rejects_non_midi_and_survives_truncation() {
        assert!(parse(b"hello").is_err());
        assert!(parse(&MIDI[..10]).is_err());
        // Chop the file mid-track: the events before the cut survive.
        let cut = parse(&MIDI[..600]).unwrap();
        assert_eq!(cut.damaged_tracks, 1);
        assert!(cut.tracks[0].len() > 10);
    }

    #[test]
    fn handles_running_status_and_masked_data_bytes() {
        // Header, one track: tempo, note on (running status for a second note
        // with a velocity byte that has its top bit set), two note offs, end.
        let mut f = Vec::new();
        f.extend_from_slice(b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x00\x60");
        let track: Vec<u8> = vec![
            0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20, // tempo 120
            0x00, 0x90, 0x3C, 0x40, // C4 on
            0x00, 0x40, 0xC0, // E4 on, velocity 0xC0 → masked to 0x40
            0x60, 0x80, 0x3C, 0x00, // C4 off after 96 ticks
            0x00, 0x40, 0x00, // E4 off (running status)
            0x00, 0xFF, 0x2F, 0x00,
        ];
        f.extend_from_slice(b"MTrk");
        f.extend_from_slice(&(track.len() as u32).to_be_bytes());
        f.extend_from_slice(&track);
        let smf = parse(&f).unwrap();
        let t = &smf.tracks[0];
        assert_eq!(smf.damaged_tracks, 0);
        assert_eq!(t[1].kind, EventKind::NoteOn { channel: 0, key: 60, velocity: 64 });
        assert_eq!(t[2].kind, EventKind::NoteOn { channel: 0, key: 64, velocity: 64 });
        assert_eq!(t[3], Event { tick: 96, kind: EventKind::NoteOff { channel: 0, key: 60 } });
        assert_eq!(t[4], Event { tick: 96, kind: EventKind::NoteOff { channel: 0, key: 64 } });
    }
}
