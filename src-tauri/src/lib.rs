//! Native side of Kalimba Man. Phase 0 owns only the data folder and
//! settings; importers arrive in phase 2. See DESIGN.md §12.

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
        .invoke_handler(tauri::generate_handler![get_settings, save_settings, get_data_dir])
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
