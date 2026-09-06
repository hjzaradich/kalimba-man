// Which tine each note lands on, decided once per song + layout so the
// renderer does not search every frame.

import { tinesForPitch, type Layout } from "../model/layout";
import type { Song } from "../model/song";

export interface NotePlacement {
  /** Tine the note lands on, or null when the kalimba cannot play it. */
  tine: number | null;
  /** For unplayable notes: the tine nearest in pitch, so the note still has a lane. */
  nearest: number;
}

export function placeNotes(song: Song, layout: Layout): NotePlacement[] {
  const cache = new Map<number, NotePlacement>();
  return song.notes.map((n) => {
    if (n.tine !== undefined && layout.tines[n.tine]?.pitch === n.pitch) {
      return { tine: n.tine, nearest: n.tine };
    }
    let p = cache.get(n.pitch);
    if (!p) {
      const candidates = tinesForPitch(layout, n.pitch);
      p = candidates.length > 0 ? { tine: candidates[0], nearest: candidates[0] } : { tine: null, nearest: nearestTine(layout, n.pitch) };
      cache.set(n.pitch, p);
    }
    return p;
  });
}

function nearestTine(layout: Layout, pitch: number): number {
  let best = 0;
  let bestDist = Infinity;
  layout.tines.forEach((t, i) => {
    const d = Math.abs(t.pitch - pitch);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
