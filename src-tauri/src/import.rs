//! Importing a tab from kalimbatabs.net. See DESIGN.md §6.
//!
//! Two eras of posts exist. Newer ones embed a MIDI file behind the on-page
//! player (`kalimbaPlayerData.midiId` is `KT_` + base64 of the `.mid` URL);
//! older ones carry number notation in `<p>` blocks of `.entry-content`,
//! interleaved with lyrics. Both go through `parse_page`; the MIDI path adds
//! `midi_to_notes` (on top of the tolerant reader in `smf.rs`). Everything
//! here is pure except `fetch`, so it is tested against saved pages in
//! `fixtures/`.

use base64::Engine;
use crate::smf::{self, EventKind};
use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;

/// Cloudflare returns 403 to anything that does not look like a browser.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const TITLE_SUFFIX: &str = "Kalimba Tabs Letter & Number Notes Tutorial - KalimbaTabs.net";
const MAX_BODY: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub title: String,
    pub artist: Option<String>,
    pub midi_url: Option<String>,
    /// Number notation and lyrics as typed in the post, one line per line.
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiNote {
    pub time: f64,
    pub duration: f64,
    pub pitch: u8,
}

/** One track of a MIDI file, with its notes, so the app can keep them all. */
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiTrack {
    pub index: usize,
    pub name: Option<String>,
    pub notes: Vec<MidiNote>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiImport {
    pub bpm: f64,
    pub time_signature: (u8, u8),
    /// Notes of the chosen track, or of every track merged.
    pub notes: Vec<MidiNote>,
    /// Every track that has notes, each with its own notes, so the song can
    /// keep them all and switch between them later.
    pub tracks: Vec<MidiTrack>,
    /// The track `notes` came from; None when merged.
    pub track: Option<usize>,
}

/// What the frontend gets back from `import_url`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub source_url: String,
    pub title: String,
    pub artist: Option<String>,
    /// "midi" when timed notes came from the site's MIDI, "text" otherwise.
    pub kind: &'static str,
    pub midi: Option<MidiImport>,
    pub text: Option<String>,
    /// Something went wrong on the MIDI path but the text fallback worked.
    pub warning: Option<String>,
}

pub fn allowed_url(url: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or("URL must start with http:// or https://")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host == "kalimbatabs.net" || host.ends_with(".kalimbatabs.net") {
        Ok(())
    } else {
        Err(format!("only kalimbatabs.net pages can be imported (got {host:?})"))
    }
}

pub fn fetch(url: &str) -> Result<Vec<u8>, String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .user_agent(USER_AGENT)
        .build()
        .new_agent();
    let mut response = agent
        .get(url)
        .call()
        .map_err(|e| format!("could not fetch {url}: {e}"))?;
    response
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_vec()
        .map_err(|e| format!("could not read {url}: {e}"))
}

pub fn parse_page(html: &str) -> PageInfo {
    let doc = Html::parse_document(html);

    let title = doc
        .select(&sel("title"))
        .next()
        .map(|t| t.text().collect::<String>())
        .map(|t| clean_title(&t))
        .unwrap_or_else(|| "Untitled".to_string());

    // <label>Artist:</label> Elvis Presley
    let artist = doc.select(&sel("li.wpuf-field-data")).find_map(|li| {
        let label = li.select(&sel("label")).next()?.text().collect::<String>();
        if label.trim() != "Artist:" {
            return None;
        }
        let value = li
            .text()
            .collect::<String>()
            .replace("Artist:", "")
            .trim()
            .to_string();
        (!value.is_empty()).then_some(value)
    });

    let midi_url = doc
        .select(&sel("script"))
        .filter_map(|s| {
            let js = s.text().collect::<String>();
            let at = js.find("kalimbaPlayerData")?;
            let rest = &js[at..];
            let start = rest.find("\"midiId\":\"")? + "\"midiId\":\"".len();
            let end = rest[start..].find('"')? + start;
            decode_midi_id(&rest[start..end])
        })
        .next();

    let text = extract_notation(&doc);

    PageInfo { title, artist, midi_url, text }
}

fn sel(css: &str) -> Selector {
    Selector::parse(css).expect("static selector")
}

fn clean_title(raw: &str) -> String {
    let t = raw.trim();
    let t = t.strip_suffix(TITLE_SUFFIX).unwrap_or(t);
    let t = t.trim().trim_end_matches('-').trim();
    if t.is_empty() {
        "Untitled".to_string()
    } else {
        t.to_string()
    }
}

/// `KT_<base64 url>` → url.
pub fn decode_midi_id(id: &str) -> Option<String> {
    let b64 = id.strip_prefix("KT_").unwrap_or(id);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    let url = String::from_utf8(bytes).ok()?;
    url.starts_with("http").then_some(url)
}

/// Paragraphs inside `.entry-content` that hold notation, joined by blank
/// lines. A paragraph counts when at least one of its lines looks like
/// notes rather than prose.
fn extract_notation(doc: &Html) -> Option<String> {
    let mut blocks = Vec::new();
    for p in doc.select(&sel(".entry-content p")) {
        let lines = paragraph_lines(&p.html());
        if lines.iter().any(|l| looks_like_notes(l)) {
            blocks.push(lines.join("\n"));
        }
    }
    (!blocks.is_empty()).then(|| blocks.join("\n\n"))
}

/// The inner text of one `<p>...</p>`, with `<br>` as line breaks and tags stripped.
fn paragraph_lines(inner_html: &str) -> Vec<String> {
    let with_breaks = regex_lite::Regex::new(r"(?i)<br\s*/?>")
        .expect("static regex")
        .replace_all(inner_html, "\n");
    let fragment = Html::parse_fragment(&with_breaks);
    let text = fragment.root_element().text().collect::<String>();
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// A line of digits 1–7 with optional octave marks, brackets and spaces, and
/// no words. "Tabs:" style prefixes are tolerated.
pub fn looks_like_notes(line: &str) -> bool {
    let line = line.trim().trim_start_matches("Tabs:").trim();
    if line.is_empty() {
        return false;
    }
    let mut digits = 0;
    for ch in line.chars() {
        match ch {
            '1'..='7' => digits += 1,
            '°' | 'º' | '˚' | '\'' | '*' | '^' | '.' | ',' | '#' | 'b' | '~' | '(' | ')' | '[' | ']' | '-' | '_' | '|' | '/' | ' ' | '\t' => {}
            _ => return false,
        }
    }
    digits > 0
}

/// Standard MIDI file → absolute-time notes. Tempo changes are honoured.
/// With `track` = None every track is merged; otherwise only that track's
/// notes are kept (tempo and meter still come from every track, as format-1
/// files put them in track 0).
pub fn midi_to_notes(bytes: &[u8], track: Option<usize>) -> Result<MidiImport, String> {
    let file = smf::parse(bytes)?;

    let with_notes: Vec<usize> = (0..file.tracks.len())
        .filter(|&i| file.tracks[i].iter().any(|e| matches!(e.kind, EventKind::NoteOn { .. })))
        .collect();
    if let Some(t) = track {
        if !with_notes.contains(&t) {
            return Err(format!("track {t} has no notes"));
        }
    }
    let (bpm, time_signature, notes) = convert(&file, track)?;
    let tracks = with_notes
        .iter()
        .map(|&index| MidiTrack {
            index,
            name: file.tracks[index].iter().find_map(|e| match &e.kind {
                EventKind::TrackName(n) if !n.is_empty() => Some(n.clone()),
                _ => None,
            }),
            notes: convert(&file, Some(index)).map(|(_, _, n)| n).unwrap_or_default(),
        })
        .collect();
    Ok(MidiImport { bpm, time_signature, notes, tracks, track })
}

/// Tempo, meter and the notes of one track (or all merged), in seconds.
fn convert(file: &smf::Smf, track: Option<usize>) -> Result<(f64, (u8, u8), Vec<MidiNote>), String> {
    // Merge tracks into one absolute-tick stream; at equal ticks, tempo and
    // time-signature changes come before notes.
    let mut events: Vec<&smf::Event> = file
        .tracks
        .iter()
        .enumerate()
        .flat_map(|(i, t)| {
            t.iter().filter(move |e| match e.kind {
                EventKind::NoteOn { .. } | EventKind::NoteOff { .. } => track.map_or(true, |x| x == i),
                _ => true,
            })
        })
        .collect();
    events.sort_by_key(|e| (e.tick, matches!(e.kind, EventKind::NoteOn { .. } | EventKind::NoteOff { .. }) as u8));

    // SMPTE files count ticks per second; one "beat" of one second keeps the
    // conversion below uniform.
    let mut us_per_beat: u32 = if file.smpte { 1_000_000 } else { 500_000 };
    let mut first_bpm: Option<f64> = None;
    let mut time_signature = (4u8, 4u8);
    let mut seconds = 0.0f64;
    let mut last_tick = 0u64;
    let mut open: HashMap<(u8, u8), (f64, usize)> = HashMap::new();
    let mut notes: Vec<MidiNote> = Vec::new();

    for e in events {
        seconds += (e.tick - last_tick) as f64 / file.ticks_per_beat * (us_per_beat as f64 / 1_000_000.0);
        last_tick = e.tick;
        match e.kind {
            EventKind::Tempo(us) => {
                if !file.smpte {
                    us_per_beat = us.max(1);
                }
                if first_bpm.is_none() {
                    first_bpm = Some(60_000_000.0 / us.max(1) as f64);
                }
            }
            EventKind::TimeSignature(n, d) => time_signature = (n, d),
            EventKind::TrackName(_) => {}
            EventKind::NoteOn { channel, key, .. } => {
                // A re-trigger without a note-off closes the previous one.
                if let Some((start, idx)) = open.remove(&(channel, key)) {
                    notes[idx].duration = (seconds - start).max(0.05);
                }
                notes.push(MidiNote { time: seconds, duration: 0.0, pitch: key });
                open.insert((channel, key), (seconds, notes.len() - 1));
            }
            EventKind::NoteOff { channel, key } => {
                if let Some((start, idx)) = open.remove(&(channel, key)) {
                    notes[idx].duration = (seconds - start).max(0.05);
                }
            }
        }
    }
    for (_, (start, idx)) in open {
        notes[idx].duration = (seconds - start).max(0.25);
    }
    notes.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap().then(a.pitch.cmp(&b.pitch)));
    // Round to milliseconds so files diff cleanly.
    for n in &mut notes {
        n.time = (n.time * 1000.0).round() / 1000.0;
        n.duration = (n.duration * 1000.0).round() / 1000.0;
    }
    if notes.is_empty() {
        return Err("the MIDI file has no notes".into());
    }
    Ok((first_bpm.unwrap_or(120.0), time_signature, notes))
}

/// The whole import: fetch the page, try the MIDI, fall back to text.
pub fn import_url(url: &str) -> Result<ImportResult, String> {
    allowed_url(url)?;
    let html = fetch(url)?;
    let html = String::from_utf8_lossy(&html);
    let page = parse_page(&html);

    let mut warning = None;
    let midi = match &page.midi_url {
        Some(midi_url) => match fetch(midi_url).and_then(|bytes| midi_to_notes(&bytes, None)) {
            Ok(m) => Some(m),
            Err(e) => {
                warning = Some(format!("MIDI import failed ({e}); used the text instead."));
                None
            }
        },
        None => None,
    };

    if midi.is_none() && page.text.is_none() {
        return Err("this page has neither a MIDI file nor number notation the importer recognises".into());
    }

    Ok(ImportResult {
        source_url: url.to_string(),
        kind: if midi.is_some() { "midi" } else { "text" },
        title: page.title,
        artist: page.artist,
        midi,
        text: page.text,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIDI_ERA: &str = include_str!("../fixtures/midi-era.html");
    const TEXT_ERA: &str = include_str!("../fixtures/text-era.html");
    const MIDI: &[u8] = include_bytes!("../fixtures/on-melancholy-hill.mid");

    #[test]
    fn midi_era_page_yields_title_artist_midi_and_text() {
        let p = parse_page(MIDI_ERA);
        assert_eq!(p.title, "On Melancholy Hill");
        assert_eq!(p.artist.as_deref(), Some("Gorillaz"));
        assert_eq!(
            p.midi_url.as_deref(),
            Some("https://www.kalimbatabs.net/wp-content/uploads/2025/12/on-melancholy-hill-gorillaz.mid")
        );
        let text = p.text.expect("text fallback present");
        assert!(text.contains("(1° 1 3 5) 5°"), "{text}");
        assert!(!text.contains("Scroll down"), "{text}");
    }

    #[test]
    fn text_era_page_yields_notation_with_lyrics_and_no_midi() {
        let p = parse_page(TEXT_ERA);
        assert_eq!(p.title, "Can't Help Falling in Love");
        assert_eq!(p.artist.as_deref(), Some("Elvis Presley"));
        assert!(p.midi_url.is_none());
        let text = p.text.expect("notation");
        assert!(text.starts_with("#A\n1°5°1°\nWise men say"), "{text}");
        assert!(text.contains("5671°  2°3°4°3°2°1°"), "{text}");
        assert!(!text.contains("Scroll down"), "{text}");
        assert!(!text.contains("tptn"), "{text}");
    }

    #[test]
    fn midi_file_becomes_timed_notes() {
        let m = midi_to_notes(MIDI, None).unwrap();
        assert_eq!(m.tracks.len(), 1);
        assert_eq!(m.tracks[0].notes.len(), 150);
        assert_eq!(m.tracks[0].notes, m.notes);
        assert!(midi_to_notes(MIDI, Some(7)).is_err());
        assert_eq!(midi_to_notes(MIDI, Some(0)).unwrap().notes.len(), 150);
        assert!((m.bpm - 120.0).abs() < 0.01, "bpm {}", m.bpm);
        assert_eq!(m.time_signature, (4, 4));
        assert_eq!(m.notes.len(), 150);
        assert_eq!(m.notes[0].time, 0.0);
        // The post opens with the chord (1 3 5 1°) then 5°: C4 E4 G4 C5 together, then G5.
        let first: Vec<u8> = m.notes.iter().take_while(|n| n.time == 0.0).map(|n| n.pitch).collect();
        assert_eq!(first, vec![60, 64, 67, 72]);
        assert_eq!(m.notes[4].pitch, 79);
        assert_eq!(m.notes[4].time, 0.5); // 384 ticks at 120 BPM
        let end = m.notes.iter().map(|n| n.time + n.duration).fold(0.0, f64::max);
        assert!((end - 62.0).abs() < 1.0, "song ends at {end}s; the site shows 1:01");
        assert!(m.notes.iter().all(|n| n.duration > 0.0));
        assert!(m.notes.windows(2).all(|w| w[0].time <= w[1].time));
    }

    #[test]
    fn midi_id_decodes() {
        assert_eq!(
            decode_midi_id("KT_aHR0cHM6Ly9leGFtcGxlLmNvbS94Lm1pZA==").as_deref(),
            Some("https://example.com/x.mid")
        );
        assert!(decode_midi_id("KT_bm90IGEgdXJs").is_none());
        assert!(decode_midi_id("garbage!").is_none());
    }

    #[test]
    fn notation_line_detection() {
        assert!(looks_like_notes("1°5°1°"));
        assert!(looks_like_notes("(1 3 5) 5°~"));
        assert!(looks_like_notes("Tabs: 1 2 3"));
        assert!(!looks_like_notes("Tabs:"));
        assert!(!looks_like_notes("Wise men say"));
        assert!(!looks_like_notes("Transposed to C Major 17 key kalimba."));
        assert!(!looks_like_notes(""));
        assert!(!looks_like_notes("#A")); // markers ride along inside note paragraphs
    }

    #[test]
    fn only_the_site_is_allowed() {
        assert!(allowed_url("https://www.kalimbatabs.net/kalimba-tabs-tutorials/x/").is_ok());
        assert!(allowed_url("https://kalimbatabs.net/x").is_ok());
        assert!(allowed_url("https://evil.com/kalimbatabs.net").is_err());
        assert!(allowed_url("https://kalimbatabs.net.evil.com/").is_err());
        assert!(allowed_url("file:///etc/passwd").is_err());
    }

    /// Hits the network; run by hand with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_import_both_eras() {
        let m = import_url("https://www.kalimbatabs.net/kalimba-tabs-tutorials/on-melancholy-hill-2/").unwrap();
        assert_eq!(m.kind, "midi");
        assert!(m.midi.unwrap().notes.len() > 50);
        let t = import_url("https://www.kalimbatabs.net/kalimba-tabs-tutorials/cant-help-falling-in-love-6/").unwrap();
        assert_eq!(t.kind, "text");
        assert!(t.text.unwrap().contains("Wise men say"));
    }
}
