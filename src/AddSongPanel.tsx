import { useEffect, useMemo, useState } from "react";
import { importFromTheoryTab, importFromUrl, songFromImport, songFromTheoryTab, type ImportResult, type TheoryTabImport } from "./importer";
import { checkCapability } from "./model/capability";
import { describeFit, refitSong, restoreOriginal } from "./model/fit";
import type { Layout } from "./model/layout";
import { parseNotation, summarize, type NoteEvent } from "./model/notation";
import { DEFAULT_TEXT_BPM, songFromText, type Song } from "./model/song";
import { isTauri } from "./settings";

interface Props {
  layout: Layout;
  /** When set, the panel edits this song instead of creating one. */
  existing?: Song | null;
  onSave: (song: Song) => void;
  onClose: () => void;
}

type Mode = "url" | "theorytab" | "text";
/** How the pure notes are adjusted to the kalimba. Manual carries a fixed shift. */
type FitMode = { kind: "auto" } | { kind: "keep" } | { kind: "manual"; semitones: number; octaves: number };

/**
 * The Add-song screen (DESIGN.md §6) and, with `existing`, the editor (§10).
 *
 * Two stages. First a *pure* song: the import as it came (kalimbatabs text
 * or MIDI, a TheoryTab analysis, an existing song's original, or the text
 * typed here). Then a *fit* to the selected kalimba (§6.5): automatic,
 * manual, or none. The fitted notes are what plays; the pure notes are kept
 * on the song so the fit can be redone for another kalimba or undone.
 * Editing the text makes the text the new pure song.
 */
export function AddSongPanel({ layout, existing, onSave, onClose }: Props) {
  const editing = !!existing;
  const [mode, setMode] = useState<Mode>(editing || !isTauri() ? "text" : "url");
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // What the import produced, before any fit. Null for paste/edit flows.
  const [imported, setImported] = useState<{ pure: Song; note: string } | null>(null);
  const [tt, setTt] = useState<TheoryTabImport | null>(null);
  const [ttSections, setTtSections] = useState<string[]>([]);
  const [ttVoice, setTtVoice] = useState(0);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [artist, setArtist] = useState(existing?.artist ?? "");
  const [bpm, setBpm] = useState(existing?.bpm ?? DEFAULT_TEXT_BPM);
  const [text, setText] = useState(existing?.text ?? "");
  /** The text last generated from a fit; while `text` equals it, the text is derived, not edited. */
  const [generated, setGenerated] = useState<string | null>(existing?.text ?? null);
  const [fitMode, setFitMode] = useState<FitMode>(() =>
    existing?.fit ? (existing.fit.auto ? { kind: "auto" } : { kind: "manual", semitones: existing.fit.semitones, octaves: existing.fit.octaves }) : { kind: editing ? "keep" : "auto" },
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const textEdited = generated === null ? text.trim() !== "" : text !== generated;
  const parsed = useMemo(() => parseNotation(text), [text]);
  const meta = useMemo(() => ({ title: title.trim() || "Untitled", artist: artist.trim() || undefined }), [title, artist]);

  // TheoryTab: rebuild the pure song when the section or voice choice changes.
  useEffect(() => {
    if (!tt) return;
    try {
      const b = songFromTheoryTab(tt, layout, { sectionIds: ttSections, voice: ttVoice, title: meta.title, artist: meta.artist });
      setImported({ pure: b.unfitted, note: `From TheoryTab, ${b.key}${b.voiceCount > 1 ? `, ${b.voiceCount} voices` : ""}.` });
      setBpm(b.unfitted.bpm);
    } catch (e) {
      setFetchError(`Could not read the analysis: ${String(e)}`);
    }
    // meta and layout are applied later; only the analysis choices matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tt, ttSections, ttVoice]);

  /** Stage one: the pure song. */
  const pure = useMemo((): Song => {
    if (imported && !textEdited) {
      return { ...imported.pure, ...meta };
    }
    // Text is the source. Keep measured timing when only pitches changed.
    const measured = existing && existing.timing === "measured" ? restoreOriginal(existing) : imported?.pure.timing === "measured" ? imported.pure : null;
    const pitches = parsed.events.filter((e): e is NoteEvent => e.kind === "note").flatMap((e) => e.pitches);
    if (measured && !textEdited && existing) {
      return { ...measured, ...meta };
    }
    if (measured && pitches.length === measured.notes.length) {
      const rest = { ...measured };
      delete rest.fit;
      delete rest.original;
      return { ...rest, ...meta, notes: measured.notes.map((n, i) => ({ ...n, pitch: pitches[i] })), text };
    }
    const song = songFromText(text, { ...meta, bpm }, parsed.events);
    song.source = imported?.pure.source ?? existing?.source;
    return song;
  }, [imported, textEdited, meta, existing, parsed, text, bpm]);

  const retimed = textEdited && (existing?.timing === "measured" || existing?.timing === "recorded" || imported?.pure.timing === "measured") && pure.timing === "uniform";

  /** Stage two: the fit. */
  const song = useMemo((): Song => {
    if (fitMode.kind === "keep") return restoreOriginal(pure);
    return refitSong(pure, layout, fitMode.kind === "manual" ? { semitones: fitMode.semitones, octaves: fitMode.octaves } : undefined);
  }, [pure, fitMode, layout]);

  // Derived text follows the fitted song until the user edits it.
  useEffect(() => {
    if (textEdited) return;
    const next = song.text ?? "";
    if (next !== text) {
      setText(next);
      setGenerated(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song]);

  const report = useMemo(() => checkCapability(song, layout), [song, layout]);
  const pureReport = useMemo(() => checkCapability(pure, layout), [pure, layout]);
  const fitText = song.fit ? describeFit({ shift: song.fit.semitones + 12 * song.fit.octaves, ...song.fit }) : null;

  const doFetch = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      if (mode === "theorytab") {
        const r = await importFromTheoryTab(url);
        setTitle(r.title);
        setArtist(r.artist ?? "");
        setTt(r);
        setTtSections(r.sections.map((s) => s.id));
        setTtVoice(0);
        setFitMode({ kind: "auto" });
        setGenerated(null);
        setText("");
        setMode("text");
        if (r.failed.length) setFetchError(`Some sections could not be fetched: ${r.failed.join("; ")}`);
      } else {
        const r: ImportResult = await importFromUrl(url);
        const built = songFromImport(r);
        setTitle(built.song.title);
        setArtist(built.song.artist ?? "");
        setBpm(built.song.bpm);
        setImported({ pure: built.song, note: `Imported from ${r.sourceUrl}${r.kind === "midi" ? " with timing from MIDI." : " as text, one beat per note."}${r.warning ? ` ${r.warning}` : ""}` });
        setFitMode({ kind: "auto" });
        setGenerated(null);
        setText("");
        setMode("text");
      }
    } catch (e) {
      setFetchError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setFetching(false);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setFetchError("Could not copy to the clipboard; select the text and copy it instead.");
    }
  };

  const noteCount = song.notes.length;
  const urlMode = mode === "url" || mode === "theorytab";
  const manual = fitMode.kind === "manual" ? fitMode : null;

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
            <button className={mode === "theorytab" ? "is-on" : ""} onClick={() => setMode("theorytab")} disabled={!isTauri()} title={isTauri() ? "Melody with real rhythm from a hooktheory.com TheoryTab page" : "Needs the desktop app"}>
              From TheoryTab
            </button>
            <button className={mode === "text" ? "is-on" : ""} onClick={() => setMode("text")}>
              Paste or type
            </button>
          </div>
        )}

        {urlMode && (
          <div className="urlbox">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={mode === "theorytab" ? "https://www.hooktheory.com/theorytab/view/artist/song" : "https://www.kalimbatabs.net/kalimba-tabs-tutorials/…"}
              onKeyDown={(e) => e.key === "Enter" && url.trim() && !fetching && doFetch()}
              autoFocus
            />
            <button className="primary" onClick={doFetch} disabled={fetching || !url.trim()}>
              {fetching ? "Fetching…" : "Fetch"}
            </button>
            {fetchError && <p className="error">{fetchError}</p>}
            <p className="muted">
              {mode === "theorytab"
                ? "TheoryTab analyses carry the melody with its rhythm and key. The import is kept as is; the fit to your kalimba is recorded separately and can be redone or undone."
                : "Newer posts come with exact timing from the site's MIDI. Older posts are text only and get one beat per note."}
            </p>
          </div>
        )}

        {mode === "text" && (
          <>
            {fetchError && <p className="error">{fetchError}</p>}
            {imported && <p className="notice">{imported.note}</p>}
            {tt && tt.sections.length > 1 && (
              <div className="notice tt">
                <div className="tt__row">
                  <span className="tt__sections">
                    Sections:
                    {tt.sections.map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={ttSections.includes(s.id)}
                          onChange={(e) => setTtSections(tt.sections.filter((x) => (x.id === s.id ? e.target.checked : ttSections.includes(x.id))).map((x) => x.id))}
                        />
                        {s.name}
                      </label>
                    ))}
                  </span>
                </div>
              </div>
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
                <input type="number" min={20} max={300} value={bpm} disabled={pure.timing === "measured"} onChange={(e) => setBpm(Math.max(20, Math.min(300, Number(e.target.value) || DEFAULT_TEXT_BPM)))} />
              </label>
            </div>

            <div className="fitbox">
              <span className="fitbox__label">Fit to {layout.name}</span>
              <label>
                <input type="radio" checked={fitMode.kind === "auto"} onChange={() => setFitMode({ kind: "auto" })} />
                Automatic{fitMode.kind === "auto" && fitText ? `: ${fitText}` : ""}
              </label>
              <label>
                <input type="radio" checked={fitMode.kind === "manual"} onChange={() => setFitMode({ kind: "manual", semitones: song.fit?.semitones ?? 0, octaves: song.fit?.octaves ?? 0 })} />
                Manual
              </label>
              {manual && (
                <span className="fitbox__manual">
                  <select value={manual.semitones} onChange={(e) => setFitMode({ ...manual, semitones: Number(e.target.value) })} title="Key shift within an octave">
                    {Array.from({ length: 12 }, (_, i) => i - 6).map((k) => (
                      <option key={k} value={k}>
                        {k > 0 ? `+${k}` : k} semitones
                      </option>
                    ))}
                  </select>
                  <select value={manual.octaves} onChange={(e) => setFitMode({ ...manual, octaves: Number(e.target.value) })} title="Whole octaves">
                    {[-2, -1, 0, 1, 2].map((o) => (
                      <option key={o} value={o}>
                        {o > 0 ? `+${o}` : o} octave{Math.abs(o) === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                  {fitText && <span className="muted">{fitText}</span>}
                </span>
              )}
              <label>
                <input type="radio" checked={fitMode.kind === "keep"} onChange={() => setFitMode({ kind: "keep" })} />
                None: keep the original notes{pureReport.unplayable.length ? ` (${pureReport.unplayable.length} shown in red)` : ""}
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
              <span>
                {summarize(parsed)}
                {" · "}
                <button className="linkish" onClick={copyText} disabled={!text.trim()} title="Copy the notation to share it as a plain tab">
                  {copied ? "Copied" : "Copy tab as text"}
                </button>
                {imported && textEdited && (
                  <>
                    {" · "}
                    <button
                      className="linkish"
                      onClick={() => {
                        setGenerated(null);
                        setText("");
                      }}
                      title="Discard text edits and go back to the import"
                    >
                      Back to the import
                    </button>
                  </>
                )}
              </span>
              <span className={retimed ? "warn" : "muted"}>
                {textEdited && (existing?.fit || imported)
                  ? "Edited text becomes the song; the recorded fit is redone from it."
                  : song.timing === "measured"
                    ? "Timing from the source is kept."
                    : retimed
                      ? "Note count changed: the song will be re-timed to one beat per note."
                      : "Uniform timing: one beat per note. Record the rhythm with the Record button later."}
              </span>
            </div>

            {report.unplayable.length > 0 && (
              <p className="panel__capability">
                <strong>{report.unplayable.length}</strong> of {noteCount} notes are not on this kalimba and will show in red.
              </p>
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
