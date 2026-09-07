//! Importing a song's analysis from hooktheory.com's TheoryTab. See
//! DESIGN.md §6.4.
//!
//! The song page lists one section id per analysed section; each section's
//! Hookpad document comes from a public, unauthenticated endpoint the site's
//! own player uses. Rust fetches and returns the raw documents; the
//! conversion to notes lives in the frontend (`src/model/hookpad.ts`) next
//! to the song model. Everything here except `fetch` is tested against
//! saved pages in `fixtures/`.

use serde::{Deserialize, Serialize};

use crate::import::fetch;

const API: &str = "https://api.hooktheory.com/v1/songs/public";
const TITLE_SUFFIX: &str = "Chords, Melody, and Music Theory Analysis - Hooktheory";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub title: String,
    pub artist: Option<String>,
    pub sections: Vec<SectionRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionData {
    pub id: String,
    pub name: String,
    /// The Hookpad document, as the JSON string the API returns.
    pub json_data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TheoryTabImport {
    pub source_url: String,
    pub title: String,
    pub artist: Option<String>,
    pub sections: Vec<SectionData>,
    /// Sections that could not be fetched, with the reason.
    pub failed: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiSong {
    #[serde(default)]
    song: Option<String>,
    #[serde(default)]
    json_data: Option<String>,
    #[serde(default)]
    xml_data: Option<String>,
}

pub fn allowed_url(url: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or("URL must start with http:// or https://")?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    if host != "hooktheory.com" && host != "www.hooktheory.com" {
        return Err(format!("only hooktheory.com TheoryTab pages can be imported (got {host:?})"));
    }
    if !path.starts_with("theorytab/view/") {
        return Err("expected a TheoryTab song page: https://www.hooktheory.com/theorytab/view/<artist>/<song>".into());
    }
    Ok(())
}

/// Title, artist and the ordered section ids and names from a song page.
pub fn parse_page(html: &str) -> PageInfo {
    let (title, artist) = title_and_artist(html);

    // shToPendingTheoryTabs("tab-yvgPXXajBgY", {id: "yvgPXXajBgY", ...
    let id_re = regex_lite::Regex::new(r#"shToPendingTheoryTabs\("tab-([A-Za-z0-9_-]+)""#).expect("static regex");
    let mut ids: Vec<String> = Vec::new();
    for c in id_re.captures_iter(html) {
        let id = c[1].to_string();
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    // Each section has a heading "<Song> – <span …>Intro</span>", in page order.
    let name_re = regex_lite::Regex::new(r#"– <span style="font-weight: 400;[^"]*">([^<]{1,60})</span>"#).expect("static regex");
    let names: Vec<String> = name_re.captures_iter(html).map(|c| c[1].trim().to_string()).collect();

    let sections = ids
        .into_iter()
        .enumerate()
        .map(|(i, id)| SectionRef {
            name: names.get(i).cloned().unwrap_or_else(|| format!("Section {}", i + 1)),
            id,
        })
        .collect();

    PageInfo { title, artist, sections }
}

/// "<title>On Melancholy Hill by Gorillaz Chords, Melody, and Music Theory Analysis - Hooktheory</title>"
fn title_and_artist(html: &str) -> (String, Option<String>) {
    let raw = html
        .find("<title>")
        .and_then(|s| html[s + 7..].find("</title>").map(|e| &html[s + 7..s + 7 + e]))
        .unwrap_or("")
        .trim();
    let raw = raw.strip_suffix(TITLE_SUFFIX).unwrap_or(raw).trim();
    let raw = decode_entities(raw);
    match raw.rsplit_once(" by ") {
        Some((song, artist)) if !song.is_empty() => (song.trim().to_string(), Some(artist.trim().to_string())),
        _ => (if raw.is_empty() { "Untitled".to_string() } else { raw }, None),
    }
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&").replace("&#039;", "'").replace("&quot;", "\"").replace("&#8217;", "’")
}

/// One section's Hookpad document from the public endpoint.
pub fn fetch_section(id: &str) -> Result<String, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(format!("invalid section id {id:?}"));
    }
    let url = format!("{API}/{id}?fields=ID,xmlData,song,jsonData");
    let bytes = fetch(&url)?;
    parse_section_body(&bytes).map_err(|e| format!("section {id}: {e}"))
}

pub fn parse_section_body(bytes: &[u8]) -> Result<String, String> {
    let song: ApiSong = serde_json::from_slice(bytes).map_err(|e| format!("unexpected response: {e}"))?;
    if let Some(json) = song.json_data.filter(|j| !j.is_empty()) {
        return Ok(json);
    }
    if song.xml_data.map_or(false, |x| !x.is_empty()) {
        return Err("this analysis is in Hookpad's old XML format, which the importer does not read yet".into());
    }
    Err(format!("no analysis data for {:?}", song.song.unwrap_or_default()))
}

pub fn import_theorytab(url: &str) -> Result<TheoryTabImport, String> {
    allowed_url(url)?;
    let html = fetch(url)?;
    let page = parse_page(&String::from_utf8_lossy(&html));
    if page.sections.is_empty() {
        return Err("no analysed sections found on that page".into());
    }
    let mut sections = Vec::new();
    let mut failed = Vec::new();
    for s in page.sections {
        match fetch_section(&s.id) {
            Ok(json_data) => sections.push(SectionData { id: s.id, name: s.name, json_data }),
            Err(e) => failed.push(format!("{}: {e}", s.name)),
        }
    }
    if sections.is_empty() {
        return Err(format!("could not fetch any section: {}", failed.join("; ")));
    }
    Ok(TheoryTabImport {
        source_url: url.to_string(),
        title: page.title,
        artist: page.artist,
        sections,
        failed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MELANCHOLY: &str = include_str!("../fixtures/theorytab-melancholy.html");
    const LET_IT_BE: &str = include_str!("../fixtures/theorytab-let-it-be.html");
    const SECTION: &[u8] = include_bytes!("../fixtures/theorytab-melancholy-yvgPXXajBgY.json");

    #[test]
    fn single_section_page() {
        let p = parse_page(MELANCHOLY);
        assert_eq!(p.title, "On Melancholy Hill");
        assert_eq!(p.artist.as_deref(), Some("Gorillaz"));
        assert_eq!(p.sections, vec![SectionRef { id: "yvgPXXajBgY".into(), name: "Intro".into() }]);
    }

    #[test]
    fn multi_section_page_keeps_order_and_names() {
        let p = parse_page(LET_IT_BE);
        assert_eq!(p.title, "Let It Be");
        assert_eq!(p.artist.as_deref(), Some("The Beatles"));
        assert_eq!(
            p.sections,
            vec![
                SectionRef { id: "_NgbRXeYgQA".into(), name: "Verse".into() },
                SectionRef { id: "nvgyBpArxkA".into(), name: "Chorus".into() },
                SectionRef { id: "yvgPv-kKoYq".into(), name: "Bridge".into() },
            ]
        );
    }

    #[test]
    fn section_body_yields_the_hookpad_json() {
        let json = parse_section_body(SECTION).unwrap();
        assert!(json.starts_with("{\"version\""), "{}", &json[..40]);
        assert!(json.contains("\"notes\""));
        assert!(parse_section_body(br#"{"ID":1,"song":"x","xmlData":null,"jsonData":null}"#).is_err());
        assert!(parse_section_body(br#"{"ID":1,"song":"x","xmlData":"<x/>","jsonData":null}"#).unwrap_err().contains("XML"));
        assert!(parse_section_body(b"not json").is_err());
    }

    #[test]
    fn only_theorytab_pages_are_allowed() {
        assert!(allowed_url("https://www.hooktheory.com/theorytab/view/gorillaz/on-melancholy-hill").is_ok());
        assert!(allowed_url("https://hooktheory.com/theorytab/view/a/b").is_ok());
        assert!(allowed_url("https://www.hooktheory.com/hookpad").is_err());
        assert!(allowed_url("https://evil.com/theorytab/view/a/b").is_err());
        assert!(fetch_section("../x").is_err());
    }

    /// Hits the network; run by hand with `cargo test -- --ignored live`.
    #[test]
    #[ignore]
    fn live_theorytab_import() {
        let r = import_theorytab("https://www.hooktheory.com/theorytab/view/the-beatles/let-it-be").unwrap();
        assert_eq!(r.sections.len(), 3);
        assert!(r.failed.is_empty());
    }
}
