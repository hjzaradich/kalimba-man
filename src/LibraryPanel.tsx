import { useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "./model/song";
import { isTauri } from "./settings";
import { deleteSong, loadSong, readSongFromFile, revealSong, type SongSummary } from "./songs";

interface Props {
  songs: SongSummary[];
  currentSlug: string | null;
  onOpen: (slug: string, song: Song) => void;
  onEdit: (slug: string, song: Song) => void;
  onImportFile: (song: Song) => void;
  onChanged: () => void;
  onAdd: () => void;
  onClose: () => void;
}

const TIMING_LABEL: Record<string, string> = {
  measured: "timed",
  recorded: "recorded",
  uniform: "uniform",
};

/** The library: every song file in the data folder. DESIGN.md roadmap phase 2. */
export function LibraryPanel({ songs, currentSlug, onOpen, onEdit, onImportFile, onChanged, onAdd, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((s) => `${s.title} ${s.artist ?? ""}`.toLowerCase().includes(q));
  }, [songs, query]);

  const withSong = async (slug: string, fn: (song: Song) => void) => {
    try {
      const song = await loadSong(slug);
      if (!song) throw new Error("file is not a song");
      fn(song);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (slug: string) => {
    try {
      await deleteSong(slug);
      setConfirmDelete(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const song = await readSongFromFile(file);
    if (!song) {
      setError(`${file.name} is not a Kalimba Man song file.`);
      return;
    }
    onImportFile(song);
  };

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel panel--wide" onClick={(e) => e.stopPropagation()}>
        <header className="panel__header">
          <h2>Library</h2>
          <button className="panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="library__tools">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title or artist" autoFocus />
          <button className="primary" onClick={onAdd}>
            Add song…
          </button>
          <button onClick={() => fileInput.current?.click()} title="Open a .kalimba.json file someone sent you">
            Import file…
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        </div>

        {error && <p className="error">{error}</p>}

        {shown.length === 0 ? (
          <p className="muted library__empty">{songs.length === 0 ? "No songs yet. Add one from kalimbatabs.net or paste a tab." : "Nothing matches."}</p>
        ) : (
          <ul className="library__list">
            {shown.map((s) => (
              <li key={s.slug} className={s.slug === currentSlug ? "is-current" : ""}>
                <button className="library__title" onClick={() => withSong(s.slug, (song) => onOpen(s.slug, song))} title="Open">
                  <span>{s.title}</span>
                  {s.artist && <span className="muted"> – {s.artist}</span>}
                </button>
                <span className={`badge badge--${s.timing}`}>{TIMING_LABEL[s.timing] ?? s.timing}</span>
                <div className="library__actions">
                  <button onClick={() => withSong(s.slug, (song) => onEdit(s.slug, song))}>Edit</button>
                  {isTauri() && (
                    <button onClick={() => revealSong(s.slug).catch((e) => setError(String(e)))} title="Show the file">
                      Reveal
                    </button>
                  )}
                  {confirmDelete === s.slug ? (
                    <>
                      <button className="danger" onClick={() => remove(s.slug)}>
                        Delete for real
                      </button>
                      <button onClick={() => setConfirmDelete(null)}>Keep</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(s.slug)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="muted library__hint">Drop a .kalimba.json anywhere on the window to import it.</p>
      </div>
    </div>
  );
}
