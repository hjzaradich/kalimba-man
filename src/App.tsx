import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { PasteSongPanel } from "./PasteSongPanel";
import { songDuration, type Song } from "./model/song";
import { PlayerCanvas } from "./player/PlayerCanvas";
import { Scheduler } from "./player/scheduler";
import { Synth } from "./player/synth";
import { Transport } from "./player/transport";
import { TransportBar } from "./player/TransportBar";
import { PRESET_LAYOUTS, presetById } from "./presets";
import { DEFAULT_SETTINGS, getDataDir, loadSettings, saveSettings, type Settings } from "./settings";
import { listSongs, loadSong, saveSong, type SongSummary } from "./songs";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [songSlug, setSongSlug] = useState<string | null>(null);
  const [saved, setSaved] = useState<SongSummary[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [handHints, setHandHints] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pasteOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "Home") {
        transport.seek(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, transport, pasteOpen]);

  if (!settings) return <div className="app app--loading">Loading…</div>;

  const layout = presetById(settings.layoutId) ?? presetById(DEFAULT_SETTINGS.layoutId)!;

  const chooseLayout = (layoutId: string) => {
    const next = { ...settings, layoutId };
    setSettings(next);
    void saveSettings(next);
  };

  const useSong = async (s: Song) => {
    setPasteOpen(false);
    setSong(s);
    try {
      const slug = await saveSong(s);
      setSongSlug(slug);
      refreshSongs();
    } catch (e) {
      setError(`Could not save song: ${String(e)}`);
    }
  };

  const openSaved = async (slug: string) => {
    if (!slug) return;
    try {
      const s = await loadSong(slug);
      if (!s) throw new Error("file is not a song");
      setSong(s);
      setSongSlug(slug);
      setError(null);
    } catch (e) {
      setError(`Could not open song: ${String(e)}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Kalimba Man</h1>

        <div className="topbar__song">
          <select value={songSlug ?? ""} onChange={(e) => openSaved(e.target.value)} title="Saved songs">
            <option value="">{song ? song.title : "No song loaded"}</option>
            {saved.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.title}
                {s.artist ? ` – ${s.artist}` : ""}
              </option>
            ))}
          </select>
          <button onClick={() => setPasteOpen(true)}>Paste tab…</button>
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
            <p>Paste a tab from kalimbatabs.net to start.</p>
            <button className="primary" onClick={() => setPasteOpen(true)}>
              Paste tab…
            </button>
          </div>
        )}
      </main>

      <TransportBar transport={transport} enabled={song !== null} onPlayToggle={togglePlay} handHints={handHints} onHandHints={setHandHints} />

      <footer className="statusbar">
        <span>
          {song ? `${song.title}${song.artist ? ` – ${song.artist}` : ""} · ${song.notes.length} notes · ${song.bpm} BPM · ${timingLabel(song)}` : "No song"}
          {" · "}
          {layout.tines.length} tines
          {layout.draft ? " · draft layout" : ""}
        </span>
        <span className={error ? "error" : "muted"}>{error ?? (dataDir ? `Data: ${dataDir}` : "Browser preview (songs kept in this browser)")}</span>
      </footer>

      {pasteOpen && <PasteSongPanel layout={layout} onUse={useSong} onClose={() => setPasteOpen(false)} />}
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
