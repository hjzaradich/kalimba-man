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

/** A slug not yet in use, so importing "Canon" twice keeps both. */
export async function freeSlug(title: string, keep?: string | null): Promise<string> {
  const base = slugify(title);
  const taken = new Set((await listSongs()).map((s) => s.slug));
  if (keep) taken.delete(keep);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
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

/** Show the song's file in Explorer or Finder. Desktop only. */
export async function revealSong(slug: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("reveal_song", { slug });
}

/** Read a `.kalimba.json` from a path on disk (drag-and-drop). Desktop only. */
export async function readSongFromPath(path: string): Promise<Song | null> {
  const raw = await invoke<unknown>("read_song_file", { path });
  return coerceSong(raw);
}

/** Read a `.kalimba.json` chosen through a file input. Works everywhere. */
export async function readSongFromFile(file: File): Promise<Song | null> {
  const text = await file.text();
  try {
    return coerceSong(JSON.parse(text));
  } catch {
    return null;
  }
}
