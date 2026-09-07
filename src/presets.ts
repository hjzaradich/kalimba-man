// The layouts that ship with the app. Files live in layouts/ at the repo root
// so they can be shared and diffed; scripts/gen-layouts.mjs regenerates them.

import type { Layout } from "./model/layout";
import standard17 from "../layouts/standard-17.layout.json";
import standard21 from "../layouts/standard-21.layout.json";
import chillAngels46 from "../layouts/chill-angels-46.layout.json";
import hluru34 from "../layouts/hluru-34.layout.json";

export const PRESET_LAYOUTS: Layout[] = [
  standard17 as Layout,
  standard21 as Layout,
  hluru34 as Layout,
  chillAngels46 as Layout,
];

export function presetById(id: string): Layout | undefined {
  return PRESET_LAYOUTS.find((l) => l.id === id);
}
