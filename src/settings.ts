// Settings persistence. Inside Tauri the Rust side owns settings.json in the
// app data folder; in a plain browser (vite dev without Tauri) we fall back to
// localStorage so the UI can be developed and screenshotted without a native
// window.

import { invoke } from "@tauri-apps/api/core";

export interface Settings {
  version: 1;
  layoutId: string;
}

export const DEFAULT_SETTINGS: Settings = { version: 1, layoutId: "standard-17" };

const STORAGE_KEY = "kalimba-man.settings";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadSettings(): Promise<Settings> {
  if (isTauri()) {
    const loaded = await invoke<Settings>("get_settings");
    return { ...DEFAULT_SETTINGS, ...loaded };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (isTauri()) {
    await invoke("save_settings", { settings });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Browser storage can be unavailable; settings are a convenience here.
  }
}

/** Where songs and layouts live on disk. Null outside Tauri. */
export async function getDataDir(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string>("get_data_dir");
}
