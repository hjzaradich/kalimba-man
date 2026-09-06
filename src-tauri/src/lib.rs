//! Native side of Kalimba Man. Phase 0 owns only the data folder and
//! settings; importers arrive in phase 2. See DESIGN.md §12.

pub mod import;
pub mod smf;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// User preferences persisted in `settings.json`. Unknown fields are dropped on
/// save, missing fields take defaults, so old files keep working.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub layout_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            version: 1,
            layout_id: "standard-17".to_string(),
        }
    }
}

/// The folders the app keeps under the platform's app-data directory.
pub const SUBFOLDERS: [&str; 2] = ["songs", "layouts"];

/// Creates the data folder and its subfolders if they are missing.
pub fn ensure_data_dir(root: &Path) -> std::io::Result<()> {
    for sub in SUBFOLDERS {
        fs::create_dir_all(root.join(sub))?;
    }
    Ok(())
}

pub fn read_settings(root: &Path) -> Settings {
    let path = root.join("settings.json");
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn write_settings(root: &Path, settings: &Settings) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(settings).expect("settings serialize");
    fs::write(root.join("settings.json"), text)
}

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

// ---- songs -----------------------------------------------------------------
//
// Songs are opaque JSON to the Rust side: the frontend owns the schema
// (src/model/song.ts). Rust only needs the title and artist for listings.

pub const SONG_EXT: &str = ".kalimba.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SongSummary {
    pub slug: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    pub timing: String,
}

/// Only lowercase letters, digits and dashes: a slug can never escape the songs folder.
fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 120
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn song_path(root: &Path, slug: &str) -> Result<PathBuf, String> {
    if !valid_slug(slug) {
        return Err(format!("invalid song name {slug:?}"));
    }
    Ok(root.join("songs").join(format!("{slug}{SONG_EXT}")))
}

pub fn list_song_files(root: &Path) -> Vec<SongSummary> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(root.join("songs")) else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(slug) = name.strip_suffix(SONG_EXT) else {
            continue;
        };
        let Ok(text) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let Some(title) = value.get("title").and_then(|t| t.as_str()) else {
            continue;
        };
        out.push(SongSummary {
            slug: slug.to_string(),
            title: title.to_string(),
            artist: value
                .get("artist")
                .and_then(|a| a.as_str())
                .map(str::to_string),
            timing: value
                .get("timing")
                .and_then(|t| t.as_str())
                .unwrap_or("uniform")
                .to_string(),
        });
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    out
}

#[tauri::command]
fn list_songs(app: tauri::AppHandle) -> Result<Vec<SongSummary>, String> {
    Ok(list_song_files(&data_root(&app)?))
}

#[tauri::command]
fn load_song(app: tauri::AppHandle, slug: String) -> Result<serde_json::Value, String> {
    let path = song_path(&data_root(&app)?, &slug)?;
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn save_song(app: tauri::AppHandle, slug: String, song: serde_json::Value) -> Result<(), String> {
    let root = data_root(&app)?;
    ensure_data_dir(&root).map_err(|e| e.to_string())?;
    let path = song_path(&root, &slug)?;
    let text = serde_json::to_string_pretty(&song).map_err(|e| e.to_string())?;
    // Write beside, then rename, so a crash mid-write cannot truncate a song.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn delete_song(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    let path = song_path(&data_root(&app)?, &slug)?;
    fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Open the songs folder with the song selected, in Explorer or Finder.
#[tauri::command]
fn reveal_song(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    let path = song_path(&data_root(&app)?, &slug)?;
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// Read a song file from anywhere on disk (drag-and-drop, Import button).
#[tauri::command]
fn read_song_file(path: String) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))
}

/// Fetching and parsing happen off the main thread; the page can be slow.
#[tauri::command]
async fn import_url(url: String) -> Result<import::ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || import::import_url(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    Ok(read_settings(&data_root(&app)?))
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let root = data_root(&app)?;
    ensure_data_dir(&root).map_err(|e| e.to_string())?;
    write_settings(&root, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            ensure_data_dir(&root)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_data_dir,
            list_songs,
            load_song,
            save_song,
            delete_song,
            reveal_song,
            read_song_file,
            import_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalimba-man-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn ensure_data_dir_creates_subfolders() {
        let root = temp_root("dirs");
        ensure_data_dir(&root).unwrap();
        for sub in SUBFOLDERS {
            assert!(root.join(sub).is_dir(), "{sub} missing");
        }
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn song_files_list_and_reject_bad_slugs() {
        let root = temp_root("songs");
        ensure_data_dir(&root).unwrap();
        assert!(list_song_files(&root).is_empty());

        let good = song_path(&root, "my-song-2").unwrap();
        fs::write(
            &good,
            r#"{"version":1,"title":"My Song","artist":"Me","timing":"uniform","notes":[]}"#,
        )
        .unwrap();
        // Files that are not songs are skipped, not fatal.
        fs::write(root.join("songs").join("notes.txt"), "hello").unwrap();
        fs::write(root.join("songs").join(format!("broken{SONG_EXT}")), "{").unwrap();

        let listed = list_song_files(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].slug, "my-song-2");
        assert_eq!(listed[0].artist.as_deref(), Some("Me"));

        for bad in ["", "../x", "Song", "a b", "a/b", "a\\b"] {
            assert!(song_path(&root, bad).is_err(), "{bad:?} should be rejected");
        }
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn settings_round_trip_and_defaults() {
        let root = temp_root("settings");
        ensure_data_dir(&root).unwrap();

        // Nothing on disk yet: defaults.
        assert_eq!(read_settings(&root), Settings::default());

        let custom = Settings {
            version: 1,
            layout_id: "chill-angels-46".into(),
        };
        write_settings(&root, &custom).unwrap();
        assert_eq!(read_settings(&root), custom);

        // The file uses camelCase so the frontend can read it as-is.
        let text = fs::read_to_string(root.join("settings.json")).unwrap();
        assert!(text.contains("\"layoutId\""), "{text}");

        // A file from an older or newer version still loads.
        fs::write(root.join("settings.json"), r#"{"version":1,"unknownField":true}"#).unwrap();
        assert_eq!(read_settings(&root).layout_id, "standard-17");

        // Corrupt JSON falls back to defaults rather than failing startup.
        fs::write(root.join("settings.json"), "{not json").unwrap();
        assert_eq!(read_settings(&root), Settings::default());

        fs::remove_dir_all(&root).unwrap();
    }
}
