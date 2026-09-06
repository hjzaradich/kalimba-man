import { useMemo, useState } from "react";
import { bestTransposition, checkCapability, foldOctaves } from "./model/capability";
import type { Layout } from "./model/layout";
import { parseNotation, summarize } from "./model/notation";
import { DEFAULT_TEXT_BPM, songFromText, transpose, type Song } from "./model/song";

interface Props {
  layout: Layout;
  onUse: (song: Song) => void;
  onClose: () => void;
}

/**
 * Phase 1's way in: paste number notation, see what parsed, fix what the
 * kalimba cannot play, and load it. Phase 2 grows this into the Add-song
 * screen with URL import.
 */
export function PasteSongPanel({ layout, onUse, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [bpm, setBpm] = useState(DEFAULT_TEXT_BPM);
  const [text, setText] = useState("");
  const [fix, setFix] = useState<"keep" | "transpose" | "fold">("keep");

  const parsed = useMemo(() => parseNotation(text), [text]);
  const base = useMemo(
    () => songFromText(text, { title: title.trim() || "Untitled", artist: artist.trim() || undefined, bpm }, parsed.events),
    [text, title, artist, bpm, parsed],
  );
  const report = useMemo(() => checkCapability(base, layout), [base, layout]);
  const suggestion = useMemo(() => (report.unplayable.length ? bestTransposition(base, layout) : null), [base, layout, report]);

  const song = useMemo(() => {
    if (fix === "transpose" && suggestion) return transpose(base, suggestion.semitones);
    if (fix === "fold") return foldOctaves(base, layout);
    return base;
  }, [base, fix, suggestion, layout]);
  const remaining = useMemo(() => checkCapability(song, layout).unplayable.length, [song, layout]);

  const noteCount = song.notes.length;

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <header className="panel__header">
          <h2>Paste a tab</h2>
          <button className="panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="panel__fields">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" autoFocus />
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

        <textarea
          className="panel__text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Number notation, e.g.\n1° 5° 1° 5° 1° (2 5 7) 5°\nLyric lines are kept as section markers."}
          spellCheck={false}
        />

        <div className="panel__status">
          <span>{summarize(parsed)}</span>
          <span className="muted">Uniform timing: one beat per note. Rhythm can be recorded in phase 3.</span>
        </div>

        {parsed.warnings.length > 0 && (
          <ul className="panel__warnings">
            {parsed.warnings.slice(0, 8).map((w, i) => (
              <li key={i}>
                Line {w.line}, col {w.col}: {w.message}
              </li>
            ))}
            {parsed.warnings.length > 8 && <li>…and {parsed.warnings.length - 8} more</li>}
          </ul>
        )}

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

        <footer className="panel__footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={noteCount === 0} onClick={() => onUse(song)}>
            Load {noteCount ? `${noteCount} notes` : ""}
          </button>
        </footer>
      </div>
    </div>
  );
}
