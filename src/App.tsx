import { useEffect, useState } from "react";
import "./App.css";
import { TineBoard } from "./board/TineBoard";
import { PRESET_LAYOUTS, presetById } from "./presets";
import { DEFAULT_SETTINGS, getDataDir, loadSettings, saveSettings, type Settings } from "./settings";

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
    getDataDir().then(setDataDir);
  }, []);

  if (!settings) return <div className="app app--loading">Loading…</div>;

  const layout = presetById(settings.layoutId) ?? presetById(DEFAULT_SETTINGS.layoutId)!;

  const chooseLayout = (layoutId: string) => {
    const next = { ...settings, layoutId };
    setSettings(next);
    void saveSettings(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Kalimba Man</h1>
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
        <div className="lane-area">
          <p className="placeholder">Falling notes arrive in phase 1.</p>
        </div>
        <div className="board">
          <TineBoard layout={layout} className="board-canvas" />
        </div>
      </main>

      <footer className="statusbar">
        <span>
          {layout.tines.length} tines · {layout.layers.length} layer{layout.layers.length === 1 ? "" : "s"}
          {layout.draft ? " · draft layout, verify against your instrument" : ""}
        </span>
        <span className="muted">{dataDir ? `Data: ${dataDir}` : "Browser preview (no data folder)"}</span>
      </footer>
    </div>
  );
}
