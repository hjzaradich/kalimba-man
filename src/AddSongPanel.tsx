import { useEffect, useMemo, useState } from "react";
import { importFromUrl, songFromImport, type ImportResult } from "./importer";
import { bestTransposition, checkCapability, foldOctaves } from "./model/capability";
import type { Layout } from "./model/layout";
import { parseNotation, summarize, type NoteEvent } from "./model/notation";
import { DEFAULT_TEXT_BPM, notesFromEvents, songFromText, transpose, type Song } from "./model/song";
import { isTauri } from "./settings";

interface Props {
  layout: Layout;
  /** When set, the panel edits this song instead of creating one. */
  existing?: Song | null;
  onSave: (song: Song) => void;
  onClose: () => void;
}

type Mode = "url" | "text";
type Fix = "keep" | "transpose" | "fold";

/**
 * The Add-song screen (DESIGN.md §6) and, with `existing`, the text editor
 * (§10). Import from a kalimbatabs.net URL or paste notation; edit the
 * text with live parsing; fix notes the kalimba lacks; save to the library.
 */
export function AddSongPanel({ layout, existing, onSave, onClose }: Props) {
  const editing = !!existing;
  const [mode, setMode] = useState<Mode>(editing || !isTauri() ? "text" : "url");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [artist, setArtist] = useState(existing?.artist ?? "");
  const [bpm, setBpm] = useState(existing?.bpm ?? DEFAULT_TEXT_BPM);
  const [text, setText] = useState(existing?.text ?? "");
  const [fix, setFix] = useState<Fix>("keep");

  // Escape closes; Ctrl/Cmd+Enter saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = useMemo(() => parseNotation(text), [text]);

  /**
   * The song as it would be saved. Measured timing survives an edit as long
   * as the note count is unchanged (relabelling pitches); otherwise the text
   * is re-timed uniformly.
   */
  const { base, retimed } = useMemo(() => {
    const meta = { title: title.trim() || "Untitled", artist: artist.trim() || undefined, bpm };
    const measuredSource = imported?.kind === "midi" && imported.midi ? songFromImport(imported, meta).song : existing?.timing === "measured" ? existing : null;
    if (measuredSource) {
      const pitches = parsed.events.filter((e): e is NoteEvent => e.kind === "note").flatMap((e) => e.pitches);
      if (pitches.length === measuredSource.notes.length) {
        const notes = measuredSource.notes.map((n, i) => ({ ...n, pitch: pitches[i] }));
        const song: Song = { ...measuredSource, ...meta, notes, text, sections: notesFromEvents(parsed.events, { bpm }).sections.length ? measuredSource.sections : measuredSource.sections };
        return { base: song, retimed: false };
      }
      const song = songFromText(text, meta, parsed.events);
      song.source = measuredSource.source;
      return { base: song, retimed: true };
    }
    const song = songFromText(text, meta, parsed.events);
    song.source = imported ? { url: imported.sourceUrl, fetchedAt: new Date().toISOString(), kind: "text" } : existing?.source;
    if (existing?.timing === "recorded") song.timing = "uniform";
    return { base: song, retimed: existing?.timing === "recorded" };
  }, [text, title, artist, bpm, parsed, imported, existing]);

  const report = useMemo(() => checkCapability(base, layout), [base, layout]);
  const suggestion = useMemo(() => (report.unplayable.length ? bestTransposition(base, layout) : null), [base, layout, report]);
  const song = useMemo(() => {
    if (fix === "transpose" && suggestion) return transpose(base, suggestion.semitones);
    if (fix === "fold") return foldOctaves(base, layout);
    return base;
  }, [base, fix, suggestion, layout]);
  const remaining = useMemo(() => checkCapability(song, layout).unplayable.length, [song, layout]);

  const doFetch = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const r = await importFromUrl(url);
      setImported(r);
      const built = songFromImport(r);
      setTitle(built.song.title);
      setArtist(built.song.artist ?? "");
      setBpm(built.song.bpm);
      setText(built.song.text ?? "");
      setMode("text");
    } catch (e) {
      setFetchError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setFetching(false);
    }
  };

  const noteCount = song.notes.length;

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel panel--wide" onClick={(e) => e.stopPropagation()}>
        <header className="panel__header">
          <h2>{editing ? `Edit “${existing!.title}”` : "Add a song"}</h2>
          <button className="panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {!editing && (
          <div className="tabs">
            <button className={mode === "url" ? "is-on" : ""} onClick={() => setMode("url")} disabled={!isTauri()} title={isTauri() ? "" : "Needs the desktop app"}>
              From kalimbatabs.net
            </button>
            <button className={mode === "text" ? "is-on" : ""} onClick={() => setMode("text")}>
              Paste or type
            </button>
          </div>
        )}

        {mode === "url" && (
          <div className="urlbox">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.kalimbatabs.net/kalimba-tabs-tutorials/…"
              onKeyDown={(e) => e.key === "Enter" && url.trim() && !fetching && doFetch()}
              autoFocus
            />
            <button className="primary" onClick={doFetch} disabled={fetching || !url.trim()}>
              {fetching ? "Fetching…" : "Fetch"}
            </button>
            {fetchError && <p className="error">{fetchError}</p>}
            <p className="muted">Newer posts come with exact timing from the site's MIDI. Older posts are text only and get one beat per note.</p>
          </div>
        )}

        {mode === "text" && (
          <>
            {imported && (
              <p className="notice">
                Imported from {imported.sourceUrl}
                {imported.kind === "midi" ? " with timing from MIDI." : " as text, one beat per note."}
                {imported.warning ? ` ${imported.warning}` : ""}
              </p>
            )}
            <div className="panel__fields">
              <label>
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" autoFocus={!imported} />
              </label>
              <label>
                Artist
                <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Optional" />
              </label>
              <label>
                BPM
                <input type="number" min={20} max={300} value={bpm} onChange={(e) => setBpm(Math.max(20, Math.min(300, Number(e.target.value) || DEFAULT_TEXT_BPM)))} />
              </label>
            </div>

            <div className="editor">
              <textarea
                className="panel__text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Number notation, e.g.\n1° 5° 1° 5° 1° (2 5 7) 5°\nLyric lines are kept as section markers."}
                spellCheck={false}
              />
              {parsed.warnings.length > 0 && (
                <ul className="panel__warnings">
                  {parsed.warnings.slice(0, 12).map((w, i) => (
                    <li key={i}>
                      Line {w.line}, col {w.col}: {w.message}
                    </li>
                  ))}
                  {parsed.warnings.length > 12 && <li>…and {parsed.warnings.length - 12} more</li>}
                </ul>
              )}
            </div>

            <div className="panel__status">
              <span>{summarize(parsed)}</span>
              <span className={retimed ? "warn" : "muted"}>
                {song.timing === "measured"
                  ? "Timing from MIDI is kept."
                  : retimed
                    ? "Note count changed: the song will be re-timed to one beat per note."
                    : "Uniform timing: one beat per note. Rhythm can be recorded in phase 3."}
              </span>
            </div>

            {report.unplayable.length > 0 && (
              <div className="panel__capability">
                <p>
                  <strong>{report.unplayable.length}</strong> of {noteCount} notes are not on this kalimba
                  {remaining !== report.unplayable.length ? ` (${remaining} after the fix below)` : ""}.
                </p>
                <div className="panel__choices">
                  <label>
                    <input type="radio" checked={fix === "keep"} onChange={() => setFix("keep")} />
                    Keep them, shown in red
                  </label>
                  {suggestion && suggestion.semitones !== 0 && (
                    <label>
                      <input type="radio" checked={fix === "transpose"} onChange={() => setFix("transpose")} />
                      Transpose {suggestion.semitones > 0 ? "+" : ""}
                      {suggestion.semitones} semitones ({suggestion.unplayable} left)
                    </label>
                  )}
                  <label>
                    <input type="radio" checked={fix === "fold"} onChange={() => setFix("fold")} />
                    Move stray notes by an octave
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        <footer className="panel__footer">
          <button onClick={onClose}>Cancel</button>
          {mode === "text" && (
            <button className="primary" disabled={noteCount === 0} onClick={() => onSave(song)}>
              {editing ? "Save" : "Save and open"}
              {noteCount ? ` (${noteCount} notes)` : ""}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
