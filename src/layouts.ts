// User layouts: one JSON file per kalimba under <data>/layouts (DESIGN.md
// §11, §12), beside the shipped presets. Same Tauri-or-localStorage split
// as songs.ts.

import { invoke } from "@tauri-apps/api/core";
import { validateLayout, type AccidentalStyle, type Layout, type LayerStyle, type Tine } from "./model/layout";
import { slugify } from "./model/song";
import { PRESET_LAYOUTS } from "./presets";
import { isTauri } from "./settings";

export interface LayoutSummary {
  slug: string;
  name: string;
  tines: number;
  draft: boolean;
}

const KEY = "kalimba-man.layouts";

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

export async function listLayouts(): Promise<LayoutSummary[]> {
  if (isTauri()) return invoke<LayoutSummary[]>("list_layouts");
  return Object.entries(browserStore())
    .flatMap(([slug, v]) => {
      const l = coerceLayout(v);
      return l ? [{ slug, name: l.name, tines: l.tines.length, draft: !!l.draft }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadLayout(slug: string): Promise<Layout | null> {
  const raw = isTauri() ? await invoke<unknown>("load_layout", { slug }) : browserStore()[slug];
  const layout = coerceLayout(raw);
  return layout ? { ...layout, id: slug } : null;
}

export async function saveLayout(layout: Layout, slug: string): Promise<void> {
  const stored = { ...layout, id: slug };
  if (isTauri()) {
    await invoke("save_layout", { slug, layout: stored });
    return;
  }
  const store = browserStore();
  store[slug] = stored;
  browserSave(store);
}

export async function deleteLayout(slug: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_layout", { slug });
    return;
  }
  const store = browserStore();
  delete store[slug];
  browserSave(store);
}

export async function revealLayout(slug: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("reveal_layout", { slug });
}

export async function readLayoutFromPath(path: string): Promise<Layout | null> {
  return coerceLayout(await invoke<unknown>("read_layout_file", { path }));
}

export async function readLayoutFromFile(file: File): Promise<Layout | null> {
  try {
    return coerceLayout(JSON.parse(await file.text()));
  } catch {
    return null;
  }
}

/** A slug for a user layout that collides with neither a preset nor another user layout. */
export async function freeLayoutSlug(name: string, keep?: string | null): Promise<string> {
  const base = slugify(name) || "kalimba";
  const taken = new Set<string>([...PRESET_LAYOUTS.map((l) => l.id), ...(await listLayouts()).map((l) => l.slug)]);
  if (keep) taken.delete(keep);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Validate an object read from disk. Returns null when it is not a layout. */
export function coerceLayout(value: unknown): Layout | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !Array.isArray(v.layers) || !Array.isArray(v.tines)) return null;
  const layers: LayerStyle[] = [];
  for (const l of v.layers as unknown[]) {
    if (typeof l !== "object" || l === null) return null;
    const x = l as Record<string, unknown>;
    if (typeof x.name !== "string" || typeof x.color !== "string") return null;
    layers.push({ name: x.name, color: x.color, ...(typeof x.xShift === "number" ? { xShift: x.xShift } : {}) });
  }
  const tines: Tine[] = [];
  for (const t of v.tines as unknown[]) {
    if (typeof t !== "object" || t === null) return null;
    const x = t as Record<string, unknown>;
    if (typeof x.pitch !== "number" || typeof x.label !== "string" || typeof x.layer !== "number" || typeof x.x !== "number") return null;
    tines.push({
      pitch: x.pitch,
      label: x.label,
      octaveDots: typeof x.octaveDots === "number" ? x.octaveDots : 0,
      layer: x.layer,
      x: x.x,
      ...(typeof x.length === "number" ? { length: x.length } : {}),
    });
  }
  const style: AccidentalStyle = v.accidentalStyle === "flat" ? "flat" : "sharp";
  const layout: Layout = {
    id: typeof v.id === "string" ? v.id : "",
    name: v.name,
    tuning: "C",
    accidentalStyle: style,
    layers,
    tines,
    draft: v.draft === true,
    notes: typeof v.notes === "string" ? v.notes : undefined,
  };
  // Structural problems (bad tiers, colliding slots) mean the file is not usable.
  return validateLayout(layout).some((p) => p.tine === undefined || /layer|slot|occupy/.test(p.message)) ? null : layout;
}
