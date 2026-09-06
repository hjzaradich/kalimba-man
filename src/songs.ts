// Song persistence: one JSON file per song under <data>/songs (DESIGN.md
// §12). Inside Tauri the Rust side reads and writes; in a plain browser we
// fall back to localStorage so the UI can be developed without a window.

import { invoke } from "@tauri-apps/api/core";
import { coerceSong, slugify, type Song } from "./model/song";
import { isTauri } from "./settings";

export interface SongSummary {
  slug: string;
  title: string;
  artist?: string;
  timing: string;
}

const KEY = "kalimba-man.songs";

function browserStore(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function browserSave(store: Record<string, unknown>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Browser storage is a convenience only.
  }
}

export async function listSongs(): Promise<SongSummary[]> {
  if (isTauri()) return invoke<SongSummary[]>("list_songs");
  return Object.entries(browserStore())
    .flatMap(([slug, v]) => {
      const s = coerceSong(v);
      return s ? [{ slug, title: s.title, artist: s.artist, timing: s.timing }] : [];
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export async function loadSong(slug: string): Promise<Song | null> {
  const raw = isTauri() ? await invoke<unknown>("load_song", { slug }) : browserStore()[slug];
  return coerceSong(raw);
}

/** Writes the song and returns the slug it was stored under. */
export async function saveSong(song: Song, slug = slugify(song.title)): Promise<string> {
  if (isTauri()) {
    await invoke("save_song", { slug, song });
    return slug;
  }
  const store = browserStore();
  store[slug] = song;
  browserSave(store);
  return slug;
}

export async function deleteSong(slug: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_song", { slug });
    return;
  }
  const store = browserStore();
  delete store[slug];
  browserSave(store);
}
