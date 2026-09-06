import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { AddSongPanel } from "./AddSongPanel";
import { LibraryPanel } from "./LibraryPanel";
import { songDuration, type Song } from "./model/song";
import { PlayerCanvas } from "./player/PlayerCanvas";
import { Scheduler } from "./player/scheduler";
import { Synth } from "./player/synth";
import { Transport } from "./player/transport";
import { TransportBar } from "./player/TransportBar";
import { PRESET_LAYOUTS, presetById } from "./presets";
import { DEFAULT_SETTINGS, getDataDir, isTauri, loadSettings, saveSettings, type Settings } from "./settings";
import { freeSlug, listSongs, readSongFromFile, readSongFromPath, saveSong, type SongSummary } from "./songs";

type Panel = { kind: "none" } | { kind: "library" } | { kind: "add" } | { kind: "edit"; slug: string; song: Song };

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [songSlug, setSongSlug] = useState<string | null>(null);
  const [saved, setSaved] = useState<SongSummary[]>([]);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [handHints, setHandHints] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // One transport, one scheduler, one synth for the life of the app.
  const transport = useMemo(() => new Transport(), []);
  const scheduler = useMemo(() => new Scheduler(transport, null, null), [transport]);
  const synthRef = useRef<Synth | null>(null);

  const refreshSongs = useCallback(() => {
    listSongs().then(setSaved).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    loadSettings().then(setSettings);
    getDataDir().then(setDataDir);
    refreshSongs();
  }, [refreshSongs]);

  useEffect(() => {
    scheduler.setSong(song);
    transport.pause();
    transport.seek(0);
    transport.setDuration(song ? songDuration(song) + 1 : 0);
  }, [song, scheduler, transport]);

  /** Audio must start from a user gesture (WKWebView); the first Play is it. */
  const ensureAudio = useCallback(() => {
    if (synthRef.current) return;
    const ctx = new AudioContext();
    synthRef.current = new Synth(ctx);
    scheduler.setSynth(synthRef.current);
    transport.attachAudio(ctx);
  }, [scheduler, transport]);

  const togglePlay = useCallback(() => {
    if (!song) return;
    ensureAudio();
    void transport.audioContext?.resume();
    transport.toggle();
  }, [song, ensureAudio, transport]);

  const panelOpen = panel.kind !== "none";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panelOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "Home") {
        transport.seek(0);
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault(); // otherwise the keystroke lands in the panel's search box
        setPanel({ kind: "library" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, transport, panelOpen]);

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
                if (!path.toLowerCase().endsWith(".json")) continue;
                try {
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
  }, [adopt]);

  if (!settings) return <div className="app app--loading">Loading…</div>;

  const layout = presetById(settings.layoutId) ?? presetById(DEFAULT_SETTINGS.layoutId)!;

  const chooseLayout = (layoutId: string) => {
    const next = { ...settings, layoutId };
    setSettings(next);
    void saveSettings(next);
  };

  const closePanel = () => setPanel({ kind: "none" });

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
          <select value={layout.id} onChange={(e) => chooseLayout(e.target.value)}>
            {PRESET_LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.draft ? " (draft)" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="stage">
        <PlayerCanvas layout={layout} song={song} transport={transport} scheduler={scheduler} handHints={handHints} className="player-canvas" />
        {!song && (
          <div className="stage__empty">
            <p>Import a tab from kalimbatabs.net, or paste one, to start.</p>
            <button className="primary" onClick={() => setPanel({ kind: "add" })}>
              Add song…
            </button>
          </div>
        )}
        {dragging && <div className="dropzone">Drop to import the song file</div>}
      </main>

      <TransportBar transport={transport} enabled={song !== null} onPlayToggle={togglePlay} handHints={handHints} onHandHints={setHandHints} />

      <footer className="statusbar">
        <span>
          {song ? `${song.notes.length} notes · ${song.bpm} BPM · ${timingLabel(song)}` : "No song"}
          {" · "}
          {layout.tines.length} tines
          {layout.draft ? " · draft layout" : ""}
        </span>
        <span className={error ? "error" : "muted"}>{error ?? (dataDir ? `Data: ${dataDir}` : "Browser preview (songs kept in this browser)")}</span>
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
          onAdd={() => setPanel({ kind: "add" })}
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
