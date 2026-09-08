// Save a clip of what the microphone hears (DESIGN.md §16.10), through the
// same path the detector listens on, so a recording of the real instrument
// is exactly what the detector would have seen. Inside Tauri the clip goes
// to the data folder's `recordings`; in a browser it downloads.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../settings";
import type { Listener } from "./listener";

export interface Clip {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Collect `seconds` of hops from a listening microphone. Resolves early
 * with what was gathered if the microphone stops; rejects if nothing was.
 */
export function recordClip(listener: Listener, seconds: number, onProgress?: (secondsLeft: number) => void): Promise<Clip> {
  return new Promise((resolve, reject) => {
    const chunks: Float32Array[] = [];
    let collected = 0;
    let sampleRate = 0;
    let lastReported = -1;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      unFrame();
      unState();
      if (!collected) {
        reject(new Error("The microphone stopped before anything was recorded."));
        return;
      }
      const samples = new Float32Array(collected);
      let o = 0;
      for (const c of chunks) {
        samples.set(c, o);
        o += c.length;
      }
      resolve({ samples, sampleRate });
    };

    const unFrame = listener.onFrame((f) => {
      sampleRate = f.sampleRate;
      chunks.push(f.samples);
      collected += f.samples.length;
      const left = Math.ceil(seconds - collected / sampleRate);
      if (left !== lastReported) {
        lastReported = left;
        onProgress?.(Math.max(0, left));
      }
      if (collected >= seconds * sampleRate) finish();
    });
    const unState = listener.subscribe((s) => {
      if (s.status !== "on") finish();
    });
    if (!listener.isOn) finish();
  });
}

/** `clip-20260907-224105`: sortable, and a valid recording name for the Rust side. */
export function clipName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `clip-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** Store the WAV bytes; returns where they went, for the notice. */
export async function saveRecording(name: string, wav: Uint8Array): Promise<string> {
  if (isTauri()) {
    return invoke<string>("save_recording", wav, { headers: { "x-name": name } });
  }
  const blob = new Blob([wav as BlobPart], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${name}.wav (downloaded)`;
}

export async function revealRecording(name: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("reveal_recording", { name });
}
