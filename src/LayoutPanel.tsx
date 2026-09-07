import { useEffect, useMemo, useRef, useState } from "react";
import { drawBoard } from "./board/drawBoard";
import type { BoardGeometry } from "./board/geometry";
import { tineAt } from "./board/hitTest";
import { deleteLayout, freeLayoutSlug, loadLayout, readLayoutFromFile, revealLayout, saveLayout, type LayoutSummary } from "./layouts";
import { validateLayout, type Layout } from "./model/layout";
import {
  addTier,
  addTine,
  blankLayout,
  compactSlots,
  duplicateLayout,
  fillFan,
  fillSemitoneAbove,
  nudgeTine,
  relabelAll,
  removeTier,
  removeTine,
  setTinePitch,
  shiftTier,
  summarizeLayout,
  updateTier,
  updateTine,
} from "./model/layoutEdit";
import { parsePitch, pitchName } from "./model/pitch";
import { PRESET_LAYOUTS } from "./presets";
import { isTauri } from "./settings";

interface Props {
  userLayouts: LayoutSummary[];
  currentId: string;
  onChoose: (id: string) => void;
  onChanged: () => void;
  onImportFile: (layout: Layout) => void;
  onClose: () => void;
}

type View = { kind: "list" } | { kind: "edit"; slug: string | null; layout: Layout };

/**
 * The kalimba manager: pick a preset, or make your own by copying one and
 * editing tiers and tines on a live board. DESIGN.md §11.
 */
export function LayoutPanel({ userLayouts, currentId, onChoose, onChanged, onImportFile, onClose }: Props) {
  const [view, setView] = useState<View>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view.kind === "edit") setView({ kind: "list" });
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, view.kind]);

  const startCopy = async (source: Layout | string) => {
    try {
      const base = typeof source === "string" ? await loadLayout(source) : source;
      if (!base) throw new Error("could not load that layout");
      setView({ kind: "edit", slug: null, layout: duplicateLayout(base, `${base.name} (copy)`) });
    } catch (e) {
      setError(String(e));
    }
  };

  const startEdit = async (slug: string) => {
    try {
      const l = await loadLayout(slug);
      if (!l) throw new Error("could not load that layout");
      setView({ kind: "edit", slug, layout: l });
    } catch (e) {
      setError(String(e));
    }
  };

  const save = async (layout: Layout, slug: string | null) => {
    try {
      const target = slug ?? (await freeLayoutSlug(layout.name));
      await saveLayout(layout, target);
      onChanged();
      onChoose(target);
      setView({ kind: "list" });
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (slug: string) => {
    try {
      await deleteLayout(slug);
      setConfirmDelete(null);
      if (currentId === slug) onChoose(PRESET_LAYOUTS[0].id);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const l = await readLayoutFromFile(file);
    if (!l) {
      setError(`${file.name} is not a Kalimba Man layout file.`);
      return;
    }
    onImportFile(l);
  };

  if (view.kind === "edit") {
    return (
      <div className="panel-backdrop" onClick={onClose}>
        <div className="panel panel--editor" onClick={(e) => e.stopPropagation()}>
          <LayoutEditor
            initial={view.layout}
            isNew={view.slug === null}
            onSave={(l) => save(l, view.slug)}
            onCancel={() => setView({ kind: "list" })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel panel--wide" onClick={(e) => e.stopPropagation()}>
        <header className="panel__header">
          <h2>Kalimbas</h2>
          <button className="panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="library__tools">
          <span className="muted">Pick one to play on, or copy one and change it to match your instrument.</span>
          <button className="primary" onClick={() => setView({ kind: "edit", slug: null, layout: blankLayout() })}>
            New from blank
          </button>
          <button onClick={() => fileInput.current?.click()} title="Open a .layout.json file someone sent you">
            Import file…
          </button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        </div>

        {error && <p className="error">{error}</p>}

        <h3 className="panel__subhead">Built in</h3>
        <ul className="library__list">
          {PRESET_LAYOUTS.map((l) => (
            <li key={l.id} className={l.id === currentId ? "is-current" : ""}>
              <button className="library__title" onClick={() => onChoose(l.id)} title={l.notes ?? "Use this kalimba"}>
                <span>{l.name}</span>
                <span className="muted"> · {l.tines.length} tines</span>
              </button>
              {l.draft ? <span className="badge">draft</span> : <span />}
              <div className="library__actions">
                <button onClick={() => startCopy(l)}>Copy and edit</button>
              </div>
            </li>
          ))}
        </ul>

        <h3 className="panel__subhead">Yours</h3>
        {userLayouts.length === 0 ? (
          <p className="muted library__empty">None yet. Copy a built-in one to start, or import a file.</p>
        ) : (
          <ul className="library__list">
            {userLayouts.map((l) => (
              <li key={l.slug} className={l.slug === currentId ? "is-current" : ""}>
                <button className="library__title" onClick={() => onChoose(l.slug)} title="Use this kalimba">
                  <span>{l.name}</span>
                  <span className="muted"> · {l.tines} tines</span>
                </button>
                {l.draft ? <span className="badge">draft</span> : <span />}
                <div className="library__actions">
                  <button onClick={() => startEdit(l.slug)}>Edit</button>
                  <button onClick={() => startCopy(l.slug)}>Copy</button>
                  {isTauri() && <button onClick={() => revealLayout(l.slug).catch((e) => setError(String(e)))}>Reveal</button>}
                  {confirmDelete === l.slug ? (
                    <>
                      <button className="danger" onClick={() => remove(l.slug)}>
                        Delete for real
                      </button>
                      <button onClick={() => setConfirmDelete(null)}>Keep</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(l.slug)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted library__hint">Drop a .layout.json anywhere on the window to import it.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EditorProps {
  initial: Layout;
  isNew: boolean;
  onSave: (layout: Layout) => void;
  onCancel: () => void;
}

function LayoutEditor({ initial, isNew, onSave, onCancel }: EditorProps) {
  const [layout, setLayout] = useState<Layout>(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [pitchText, setPitchText] = useState("");
  const [fill, setFill] = useState<{ tier: number; low: string; high: string }>({ tier: 0, low: "C4", high: "E6" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef<BoardGeometry | null>(null);

  const problems = useMemo(() => validateLayout(layout), [layout]);
  const tine = selected !== null ? layout.tines[selected] : null;

  useEffect(() => {
    if (tine) setPitchText(pitchName(tine.pitch, layout.accidentalStyle));
  }, [tine, layout.accidentalStyle]);

  // Live board preview with the selected tine glowing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    const render = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (layout.tines.length === 0) {
        ctx.fillStyle = "#8b90a0";
        ctx.font = "14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No tines yet. Fill a tier below, or add tines one by one.", width / 2, height / 2);
        geoRef.current = null;
        return;
      }
      geoRef.current = drawBoard(ctx, layout, width, height, 0, selected !== null ? [{ tine: selected, strength: 1 }] : []);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [layout, selected]);

  const onBoardClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const geo = geoRef.current;
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSelected(tineAt(geo, e.clientX - rect.left, e.clientY - rect.top));
  };

  const apply = (next: Layout) => setLayout(next);
  const applyPitch = () => {
    const p = parsePitch(pitchText);
    if (p !== null && selected !== null) apply(setTinePitch(layout, selected, p));
  };

  const doFill = () => {
    const lo = parsePitch(fill.low);
    const hi = parsePitch(fill.high);
    if (lo === null || hi === null) return;
    apply(compactSlots(fillFan(layout, fill.tier, lo, hi)));
    setSelected(null);
  };

  return (
    <>
      <header className="panel__header">
        <h2>{isNew ? "New kalimba" : `Edit “${initial.name}”`}</h2>
        <button className="panel__close" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </header>

      <div className="editor__top">
        <label>
          Name
          <input value={layout.name} onChange={(e) => apply({ ...layout, name: e.target.value })} />
        </label>
        <label>
          Accidentals
          <select value={layout.accidentalStyle} onChange={(e) => apply(relabelAll(layout, e.target.value as "sharp" | "flat"))}>
            <option value="sharp">Sharps (4♯)</option>
            <option value="flat">Flats (5♭)</option>
          </select>
        </label>
        <label className="editor__check">
          <input type="checkbox" checked={!layout.draft} onChange={(e) => apply({ ...layout, draft: !e.target.checked })} />
          Checked against the instrument
        </label>
        <span className="muted">{summarizeLayout(layout)}</span>
      </div>

      <div className="editor__board">
        <canvas ref={canvasRef} onMouseDown={onBoardClick} />
      </div>

      <div className="editor__columns">
        <section className="editor__section">
          <h3>Tiers (bottom first)</h3>
          {layout.layers.map((l, i) => (
            <div key={i} className="editor__tier">
              <input value={l.name} onChange={(e) => apply(updateTier(layout, i, { name: e.target.value }))} title="Tier name" />
              <input type="color" value={l.color} onChange={(e) => apply(updateTier(layout, i, { color: e.target.value }))} title="Colour" />
              <label title="Sideways nudge, in lanes, so stacked lanes stay distinct">
                Shift
                <input type="number" step={0.05} min={-0.4} max={0.4} value={l.xShift ?? 0} onChange={(e) => apply(updateTier(layout, i, { xShift: Number(e.target.value) }))} />
              </label>
              <button onClick={() => apply(shiftTier(layout, i, -1))} title="Move every tine on this tier one column left">
                ◀
              </button>
              <button onClick={() => apply(shiftTier(layout, i, 1))} title="Move every tine on this tier one column right">
                ▶
              </button>
              <button
                onClick={() => {
                  apply(addTine(layout, i));
                  setSelected(layout.tines.length);
                }}
              >
                + tine
              </button>
              {i > 0 && (
                <button onClick={() => apply(fillSemitoneAbove(layout, i, i - 1))} title="One tine over each tine of the tier below, a semitone higher">
                  Fill: semitone above {layout.layers[i - 1].name}
                </button>
              )}
              <button disabled={layout.layers.length <= 1} onClick={() => apply(removeTier(layout, i))} title="Remove this tier and its tines">
                ×
              </button>
            </div>
          ))}
          <div className="editor__row">
            <button onClick={() => apply(addTier(layout))}>+ tier</button>
          </div>
          <div className="editor__row editor__fill">
            <span>Fill tier</span>
            <select value={fill.tier} onChange={(e) => setFill({ ...fill, tier: Number(e.target.value) })}>
              {layout.layers.map((l, i) => (
                <option key={i} value={i}>
                  {l.name}
                </option>
              ))}
            </select>
            <span>with a fan from</span>
            <input value={fill.low} onChange={(e) => setFill({ ...fill, low: e.target.value })} size={4} />
            <span>to</span>
            <input value={fill.high} onChange={(e) => setFill({ ...fill, high: e.target.value })} size={4} />
            <button onClick={doFill}>Fill</button>
          </div>
        </section>

        <section className="editor__section">
          <h3>Selected tine</h3>
          {tine && selected !== null ? (
            <div className="editor__tine">
              <label>
                Pitch
                <input value={pitchText} onChange={(e) => setPitchText(e.target.value)} onBlur={applyPitch} onKeyDown={(e) => e.key === "Enter" && applyPitch()} size={5} />
              </label>
              <label>
                Printed label
                <input value={tine.label} onChange={(e) => apply(updateTine(layout, selected, { label: e.target.value }))} size={3} />
              </label>
              <label>
                Dots
                <input type="number" min={-3} max={3} value={tine.octaveDots} onChange={(e) => apply(updateTine(layout, selected, { octaveDots: Number(e.target.value) }))} />
              </label>
              <label>
                Tier
                <select value={tine.layer} onChange={(e) => apply(updateTine(layout, selected, { layer: Number(e.target.value) }))}>
                  {layout.layers.map((l, i) => (
                    <option key={i} value={i}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Column
                <span className="editor__nudge">
                  <button onClick={() => apply(nudgeTine(layout, selected, -1))}>◀</button>
                  {tine.x}
                  <button onClick={() => apply(nudgeTine(layout, selected, 1))}>▶</button>
                </span>
              </label>
              <button
                className="danger"
                onClick={() => {
                  apply(removeTine(layout, selected));
                  setSelected(null);
                }}
              >
                Remove tine
              </button>
            </div>
          ) : (
            <p className="muted">Click a tine on the board to edit it.</p>
          )}
          {problems.length > 0 && (
            <ul className="panel__warnings">
              {problems.slice(0, 6).map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="panel__footer">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={problems.length > 0 || layout.tines.length === 0} onClick={() => onSave(compactSlots(layout))}>
          Save and use
        </button>
      </footer>
    </>
  );
}
