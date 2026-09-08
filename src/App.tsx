import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AddSongPanel } from "./AddSongPanel";
import { LayoutPanel } from "./LayoutPanel";
import { LibraryPanel } from "./LibraryPanel";
import { freeLayoutSlug, listLayouts, loadLayout, readLayoutFromFile, readLayoutFromPath, saveLayout, type LayoutSummary } from "./layouts";
import type { Layout, Tine } from "./model/layout";
import { describeFit, fittedElsewhere, refitSong, restoreOriginal, selectTrack } from "./model/fit";
import { applyRecordedTiming, groupNotes } from "./model/recording";
import { songDuration, type Song } from "./model/song";
import { PlayerCanvas } from "./player/PlayerCanvas";
import { Practice, type PracticeState } from "./player/practice";
import { Scheduler } from "./player/scheduler";
import { Synth } from "./player/synth";
import { Transport } from "./player/transport";
import { TransportBar } from "./player/TransportBar";
import { UpdateBanner } from "./UpdateBanner";
import { useUpdater } from "./useUpdater";
import { PRESET_LAYOUTS, presetById } from "./presets";
import { DEFAULT_SETTINGS, getDataDir, isTauri, loadSettings, saveSettings, type Settings } from "./settings";
import { freeSlug, listSongs, readSongFromFile, readSongFromPath, saveSong, type SongSummary } from "./songs";
import { importMidiPath, songFromMidiFile } from "./importer";

type Panel = { kind: "none" } | { kind: "library" } | { kind: "add" } | { kind: "edit"; slug: string; song: Song } | { kind: "layouts" };

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [songSlug, setSongSlug] = useState<string | null>(null);
  const [saved, setSaved] = useState<SongSummary[]>([]);
  const [userLayouts, setUserLayouts] = useState<LayoutSummary[]>([]);
  const [userLayout, setUserLayout] = useState<Layout | null>(null);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [handHints, setHandHints] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [practiceState, setPracticeState] = useState<PracticeState>({ mode: "off", waiting: false, next: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const updater = useUpdater();

  // One transport, one scheduler, one synth for the life of the app.
  const transport = useMemo(() => new Transport(), []);
  const scheduler = useMemo(() => new Scheduler(transport, null, null), [transport]);
  const synthRef = useRef<Synth | null>(null);
  const songRef = useRef<{ song: Song | null; slug: string | null }>({ song: null, slug: null });
  songRef.current = { song, slug: songSlug };
  const layoutRef = useRef<Layout>(presetById(DEFAULT_SETTINGS.layoutId)!);
  const recordedRef = useRef<((taps: number[]) => void) | null>(null);
  const practice = useMemo(
    () =>
      new Practice(transport, scheduler, () => synthRef.current, (e) => {
        setPracticeState(e.state);
        if (e.type === "recorded") recordedRef.current?.(e.taps);
      }),
    [transport, scheduler],
  );
  useEffect(() => () => practice.dispose(), [practice]);

  const refreshSongs = useCallback(() => {
    listSongs().then(setSaved).catch((e) => setError(String(e)));
  }, []);
  const refreshLayouts = useCallback(() => {
    listLayouts().then(setUserLayouts).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadSettings().then(setSettings);
    getDataDir().then(setDataDir);
    refreshSongs();
    refreshLayouts();
  }, [refreshSongs, refreshLayouts]);

  // A user layout is a file; load it when it becomes the selected one.
  const layoutId = settings?.layoutId;
  useEffect(() => {
    if (!layoutId || presetById(layoutId)) {
      setUserLayout(null);
      return;
    }
    let cancelled = false;
    loadLayout(layoutId)
      .then((l) => {
        if (!cancelled) setUserLayout(l);
      })
      .catch(() => {
        if (!cancelled) setUserLayout(null);
      });
    return () => {
      cancelled = true;
    };
  }, [layoutId, userLayouts]);

  /** Audio must start from a user gesture (WKWebView); the first Play is it. */
  const ensureAudio = useCallback(() => {
    if (synthRef.current) return;
    const ctx = new AudioContext();
    synthRef.current = new Synth(ctx);
    scheduler.setSynth(synthRef.current);
    transport.attachAudio(ctx);
  }, [scheduler, transport]);

  useEffect(() => {
    scheduler.setSong(song);
    practice.setSong(song);
    transport.pause();
    transport.seek(0);
    transport.setDuration(song ? songDuration(song) + 1 : 0);
  }, [song, scheduler, practice, transport]);

  useEffect(() => {
    scheduler.setMetronome(metronome);
  }, [metronome, scheduler]);

  /** Space or a click on the canvas: a hit in wait/record mode, otherwise play/pause. */
  const hit = useCallback(() => {
    ensureAudio();
    void transport.audioContext?.resume();
    if (practice.hit()) return;
    if (practice.state.mode === "record") return;
    if (song) transport.toggle();
  }, [practice, song, transport, ensureAudio]);

  /**
   * Sound one pitch now, from a user gesture. WebKit parks the context as
   * "suspended" or "interrupted" after idle time or a system interruption,
   * and a pluck scheduled on a parked context never sounds; so wait for it
   * to run first. The await resolves inside the gesture's activation window.
   */
  const soundPitch = useCallback(
    async (pitch: number) => {
      ensureAudio();
      const ctx = transport.audioContext;
      const synth = synthRef.current;
      if (!ctx || !synth) return;
      try {
        if (ctx.state !== "running") await ctx.resume();
        synth.pluck(pitch, ctx.currentTime);
      } catch (e) {
        setError(`Could not play the note: ${String(e)}`);
      }
    },
    [ensureAudio, transport],
  );

  /** A tine was clicked: in a hold, that is the hit; otherwise just sound it. */
  const playTine = useCallback(
    (tine: Tine) => {
      ensureAudio();
      void transport.audioContext?.resume();
      if (practice.state.waiting) {
        practice.hit();
        return true;
      }
      void soundPitch(tine.pitch);
      return true;
    },
    [practice, transport, ensureAudio, soundPitch],
  );

  const setWaitMode = useCallback(
    (on: boolean) => {
      practice.setMode(on ? "wait" : "off");
      setNotice(on ? "Wait mode: playback holds at each note until you play it." : null);
    },
    [practice],
  );

  const startRecording = useCallback(() => {
    if (!song) return;
    ensureAudio();
    void transport.audioContext?.resume();
    recordedRef.current = (taps) => {
      const current = songRef.current;
      if (!current.song) return;
      try {
        const retimed = applyRecordedTiming(current.song, groupNotes(current.song.notes), taps);
        practice.setMode("off");
        void adopt(retimed, current.slug);
        setNotice("Rhythm recorded and saved. Play it back to check it.");
      } catch (e) {
        setError(String(e));
      }
    };
    practice.setMode("record");
    setNotice("Recording: tap Space or click the board once for each note, in your own time.");
  }, [song, practice, transport, ensureAudio]);

  const cancelRecording = useCallback(() => {
    practice.setMode("off");
    setNotice("Recording cancelled.");
  }, [practice]);

  const togglePlay = useCallback(() => {
    if (!song || practice.state.mode === "record") return;
    ensureAudio();
    void transport.audioContext?.resume();
    transport.toggle();
  }, [song, ensureAudio, transport, practice]);

  const panelOpen = panel.kind !== "none";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panelOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === "Space" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault(); // also stops a focused toolbar button from being "clicked" by Space
        hit();
      } else if (e.code === "Escape" && practice.state.mode === "record") {
        cancelRecording();
      } else if (e.code === "Home") {
        transport.seek(0);
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault(); // otherwise the keystroke lands in the panel's search box
        setPanel({ kind: "library" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hit, transport, panelOpen, practice, cancelRecording]);

  /** Store a song under a free slug (or its own), open it, refresh the list. */
  const adopt = useCallback(
    async (s: Song, keepSlug?: string | null) => {
      try {
        const slug = await freeSlug(s.title, keepSlug);
        await saveSong(s, slug);
        setSong(s);
        setSongSlug(slug);
        setError(null);
        refreshSongs();
      } catch (e) {
        setError(`Could not save song: ${String(e)}`);
      }
    },
    [refreshSongs],
  );

  /** Store an imported layout under a free slug and switch to it. */
  const adoptLayout = useCallback(
    async (l: Layout) => {
      try {
        const slug = await freeLayoutSlug(l.name);
        await saveLayout(l, slug);
        refreshLayouts();
        setSettings((s) => {
          const next = { ...(s ?? DEFAULT_SETTINGS), layoutId: slug };
          void saveSettings(next);
          return next;
        });
        setNotice(`Imported kalimba "${l.name}".`);
      } catch (e) {
        setError(`Could not import layout: ${String(e)}`);
      }
    },
    [refreshLayouts],
  );

  // Drag-and-drop of .kalimba.json files. Tauri delivers paths through its
  // own event; a browser delivers File objects through HTML5 DnD.
  useEffect(() => {
    if (isTauri()) {
      let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
        getCurrentWebview()
          .onDragDropEvent(async (event) => {
            const p = event.payload;
            if (p.type === "enter" || p.type === "over") setDragging(true);
            else if (p.type === "leave") setDragging(false);
            else if (p.type === "drop") {
              setDragging(false);
              for (const path of p.paths) {
                const lower = path.toLowerCase();
                if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
                  try {
                    const m = await importMidiPath(path);
                    const name = path.split(/[\\/]/).pop() ?? "song.mid";
                    const s = songFromMidiFile(m, name);
                    await adopt(refitSong(s, layoutRef.current));
                    setNotice(`Imported ${name}${s.tracks ? `: ${s.tracks.length} tracks, the fullest selected; switch with the Track menu` : ""}.`);
                  } catch (e) {
                    setError(`Could not import ${path}: ${String(e)}`);
                  }
                  continue;
                }
                if (!lower.endsWith(".json")) continue;
                try {
                  if (path.toLowerCase().endsWith(".layout.json")) {
                    const l = await readLayoutFromPath(path);
                    if (l) await adoptLayout(l);
                    else setError(`${path} is not a Kalimba Man layout file.`);
                    continue;
                  }
                  const s = await readSongFromPath(path);
                  if (s) await adopt(s);
                  else setError(`${path} is not a Kalimba Man song file.`);
                } catch (e) {
                  setError(String(e));
                }
              }
            }
          })
          .then((fn) => {
            unlisten = fn;
          }),
      );
      return () => unlisten?.();
    }
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      for (const file of Array.from(e.dataTransfer?.files ?? [])) {
        if (file.name.toLowerCase().endsWith(".layout.json")) {
          const l = await readLayoutFromFile(file);
          if (l) await adoptLayout(l);
          else setError(`${file.name} is not a Kalimba Man layout file.`);
          continue;
        }
        const s = await readSongFromFile(file);
        if (s) await adopt(s);
        else setError(`${file.name} is not a Kalimba Man song file.`);
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [adopt, adoptLayout]);

  if (!settings) return <div className="app app--loading">Loading…</div>;

  const layout = presetById(settings.layoutId) ?? (userLayout && userLayout.id === settings.layoutId ? userLayout : null) ?? presetById(DEFAULT_SETTINGS.layoutId)!;
  layoutRef.current = layout;

  const chooseLayout = (layoutId: string) => {
    const next = { ...settings, layoutId };
    setSettings(next);
    void saveSettings(next);
  };

  const closePanel = () => setPanel({ kind: "none" });

  /** Redo the recorded fit for the selected kalimba, or drop it. */
  const refit = (mode: "refit" | "original") => {
    if (!song) return;
    const next = mode === "refit" ? refitSong(song, layout) : restoreOriginal(song);
    void adopt(next, songSlug);
    setNotice(mode === "refit" && next.fit ? `Refitted for ${layout.name}: ${describeFit({ shift: next.fit.semitones + 12 * next.fit.octaves, ...next.fit })}.` : "Original notes restored.");
  };

  const unload = () => {
    practice.setMode("off");
    setSong(null);
    setSongSlug(null);
    setNotice(null);
    setError(null);
  };

  return (
    <div className={`app${dragging ? " is-dragging" : ""}`}>
      <header className="topbar">
        <h1 className="brand">Kalimba Man</h1>

        <div className="topbar__song">
          <button onClick={() => setPanel({ kind: "library" })} title="L">
            Library
          </button>
          <span className="topbar__title" title={song?.title}>
            {song ? `${song.title}${song.artist ? ` – ${song.artist}` : ""}` : "No song loaded"}
          </span>
          {song && song.tracks && song.tracks.length > 1 && (
            <label className="picker" title="Which track of the file plays; the others show as ghosts">
              <span>Track</span>
              <select
                value={song.activeTrack ?? 0}
                onChange={(e) => {
                  const next = selectTrack(song, Number(e.target.value), layout);
                  void adopt(next, songSlug);
                }}
              >
                {song.tracks.map((t, i) => (
                  <option key={i} value={i}>
                    {t.name} ({t.notes.length})
                  </option>
                ))}
              </select>
            </label>
          )}
          {song && songSlug && (
            <button onClick={() => setPanel({ kind: "edit", slug: songSlug, song })} title="Edit the notation">
              Edit
            </button>
          )}
          <button className="primary" onClick={() => setPanel({ kind: "add" })}>
            Add song…
          </button>
        </div>

        <label className="picker">
          <span>Kalimba</span>
          <select
            value={layout.id}
            onChange={(e) => {
              chooseLayout(e.target.value);
              // Let focus go, or Space keeps landing in the picker (WebKit).
              e.currentTarget.blur();
            }}
          >
            <optgroup label="Built in">
              {PRESET_LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.draft ? " (draft)" : ""}
                </option>
              ))}
            </optgroup>
            {userLayouts.length > 0 && (
              <optgroup label="Yours">
                {userLayouts.map((l) => (
                  <option key={l.slug} value={l.slug}>
                    {l.name}
                    {l.draft ? " (draft)" : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button onClick={() => setPanel({ kind: "layouts" })} title="Copy, edit, import or make a kalimba">
            Manage…
          </button>
        </label>
      </header>

      <UpdateBanner updater={updater} />
      {song && fittedElsewhere(song, layout) && (
        <div className="fit-banner">
          <span>
            This song was fitted for <strong>{song.fit!.layoutName}</strong>
            {checkUnplayable(song, layout)}.
          </span>
          <span className="update-banner__actions">
            <button onClick={() => refit("original")} title="Back to the notes as imported">
              Original notes
            </button>
            <button className="primary" onClick={() => refit("refit")}>
              Refit for {layout.name}
            </button>
          </span>
        </div>
      )}

      <main className="stage">
        <PlayerCanvas layout={layout} song={song} transport={transport} scheduler={scheduler} practice={practice} onHit={hit} onTine={playTine} handHints={handHints} className="player-canvas" />
        {!song && (
          <div className="stage__empty">
            <button className="stage__big" onClick={() => setPanel({ kind: "library" })}>
              Library
            </button>
            <button className="stage__big primary" onClick={() => setPanel({ kind: "add" })}>
              Add song…
            </button>
          </div>
        )}
        {dragging && <div className="dropzone">Drop to import the song file</div>}
      </main>

      <TransportBar
        transport={transport}
        enabled={song !== null}
        sections={song?.sections}
        onPlayToggle={togglePlay}
        handHints={handHints}
        onHandHints={setHandHints}
        metronome={metronome}
        onMetronome={setMetronome}
        practice={practiceState}
        onWaitMode={setWaitMode}
        onRecord={startRecording}
        onCancelRecord={cancelRecording}
      />

      <footer className="statusbar">
        <span>
          {song ? `${song.notes.length} notes · ${song.bpm} BPM · ${timingLabel(song)}` : "No song"}
          {" · "}
          {layout.tines.length} tines
          {layout.draft ? " · draft layout" : ""}
        </span>
        <span className={error ? "error" : "muted"}>{error ?? notice ?? (dataDir ? `Data: ${dataDir}` : "Browser preview (songs kept in this browser)")}</span>
      </footer>

      {panel.kind === "library" && (
        <LibraryPanel
          songs={saved}
          currentSlug={songSlug}
          onOpen={(slug, s) => {
            setSong(s);
            setSongSlug(slug);
            closePanel();
          }}
          onEdit={(slug, s) => setPanel({ kind: "edit", slug, song: s })}
          onImportFile={(s) => {
            void adopt(s);
            closePanel();
          }}
          onChanged={() => {
            refreshSongs();
          }}
          onDeleted={(slug) => {
            if (slug === songSlug) unload();
          }}
          onAdd={() => setPanel({ kind: "add" })}
          onClose={closePanel}
        />
      )}
      {panel.kind === "layouts" && (
        <LayoutPanel
          userLayouts={userLayouts}
          currentId={layout.id}
          onChoose={(id) => chooseLayout(id)}
          onChanged={refreshLayouts}
          onImportFile={(l) => {
            void adoptLayout(l);
            closePanel();
          }}
          onClose={closePanel}
        />
      )}
      {panel.kind === "add" && (
        <AddSongPanel
          layout={layout}
          onSave={(s) => {
            void adopt(s);
            closePanel();
          }}
          onClose={closePanel}
        />
      )}
      {panel.kind === "edit" && (
        <AddSongPanel
          layout={layout}
          existing={panel.song}
          onSave={(s) => {
            void adopt(s, panel.slug).then(() => transport.seek(0));
            closePanel();
          }}
          onClose={closePanel}
        />
      )}
    </div>
  );
}

import { checkCapability } from "./model/capability";

function checkUnplayable(song: Song, layout: Layout): string {
  const n = checkCapability(song, layout).unplayable.length;
  return n ? `; ${n} of its notes are not on this kalimba` : "";
}

function timingLabel(song: Song): string {
  switch (song.timing) {
    case "measured":
      return "timed from MIDI";
    case "recorded":
      return "rhythm recorded";
    default:
      return "uniform beats (rhythm not encoded)";
  }
}
