// The microphone (DESIGN.md §16.4): opens the input the user chose, feeds
// it through the pump worklet on the AudioContext the synth already uses,
// and hands each hop to whoever subscribed, stamped with its time on that
// context's clock. This is the only file that touches the capture API;
// everything downstream is pure and tested with arrays.

import { LevelMeter } from "./level";

/** Samples per hop the pump posts; about 11 ms at 48 kHz. */
export const HOP = 512;

export type ListenerStatus = "off" | "starting" | "on" | "error";

export interface ListenerState {
  status: ListenerStatus;
  /** Why it is off, when it is off because of a problem. */
  error: string | null;
  deviceId: string | null;
  deviceLabel: string | null;
}

export interface MicFrame {
  /** AudioContext time of the first sample, on the transport's clock. */
  time: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

const OFF: ListenerState = { status: "off", error: null, deviceId: null, deviceLabel: null };

// Plain JS, served by URL: Vite copies it as an asset in a build and serves
// it from source in dev, so the same line works under `vite`, `tauri dev`
// and the packaged app.
const WORKLET_URL = new URL("./pump.worklet.js", import.meta.url);

/** The worklet module is added once per context. */
const modules = new WeakMap<AudioContext, Promise<void>>();
function ensureModule(ctx: AudioContext): Promise<void> {
  let p = modules.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL.href);
    modules.set(ctx, p);
    p.catch(() => modules.delete(ctx));
  }
  return p;
}

interface Graph {
  ctx: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  sink: GainNode;
}

export class Listener {
  private state: ListenerState = OFF;
  private graph: Graph | null = null;
  /** Bumped by start and stop so a start overtaken by a stop gives up. */
  private generation = 0;
  private stateSubs = new Set<(s: ListenerState) => void>();
  private frameSubs = new Set<(f: MicFrame) => void>();
  readonly meter = new LevelMeter();

  get current(): ListenerState {
    return this.state;
  }

  get isOn(): boolean {
    return this.state.status === "on";
  }

  subscribe(fn: (s: ListenerState) => void): () => void {
    this.stateSubs.add(fn);
    return () => this.stateSubs.delete(fn);
  }

  onFrame(fn: (f: MicFrame) => void): () => void {
    this.frameSubs.add(fn);
    return () => this.frameSubs.delete(fn);
  }

  private set(state: ListenerState) {
    this.state = state;
    for (const fn of this.stateSubs) fn(state);
  }

  /**
   * Open the microphone on `ctx`. Resolves true when hops are flowing. On
   * failure the state carries the reason and the listener is off. Must be
   * called from a user gesture the first time (the permission prompt and,
   * on WebKit, the context itself need one).
   */
  async start(ctx: AudioContext, deviceId: string | null = null): Promise<boolean> {
    this.stop();
    const gen = ++this.generation;
    this.set({ status: "starting", error: null, deviceId, deviceLabel: null });

    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      this.set({ ...OFF, status: "error", error: "The microphone is not available in this window." });
      return false;
    }

    let stream: MediaStream;
    try {
      stream = await openStream(media, deviceId);
    } catch (e) {
      if (gen === this.generation) this.set({ ...OFF, status: "error", error: describe(e) });
      return false;
    }
    if (gen !== this.generation) {
      release(stream);
      return false;
    }

    try {
      await ensureModule(ctx);
      if (ctx.state !== "running") await ctx.resume();
    } catch (e) {
      release(stream);
      if (gen === this.generation) this.set({ ...OFF, status: "error", error: `Could not start audio: ${String(e)}` });
      return false;
    }
    if (gen !== this.generation) {
      release(stream);
      return false;
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "kalimba-pump", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { hop: HOP },
    });
    // A node nobody listens to is never pulled; a silent sink keeps it running.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    this.graph = { ctx, stream, source, node, sink };
    this.meter.reset();

    node.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) => {
      if (this.graph?.node !== node) return;
      const { frame, samples } = e.data;
      this.meter.push(samples);
      const f: MicFrame = { time: frame / ctx.sampleRate, samples, sampleRate: ctx.sampleRate };
      for (const fn of this.frameSubs) fn(f);
    };

    const track = stream.getAudioTracks()[0];
    // Unplugged, or taken by the OS: report it instead of going quiet.
    track.onended = () => {
      if (this.graph?.stream !== stream) return;
      this.stop();
      this.set({ ...OFF, status: "error", error: "The microphone was disconnected." });
    };

    const settings = track.getSettings();
    this.set({ status: "on", error: null, deviceId: settings.deviceId ?? deviceId, deviceLabel: track.label || null });
    return true;
  }

  /** Close the input and drop the graph. Safe to call when already off. */
  stop() {
    this.generation++;
    const g = this.graph;
    this.graph = null;
    if (g) {
      g.node.port.onmessage = null;
      g.node.port.close();
      g.source.disconnect();
      g.node.disconnect();
      g.sink.disconnect();
      release(g.stream);
    }
    this.meter.reset();
    if (this.state.status !== "off") this.set(OFF);
  }

  /**
   * Inputs the browser will offer. Labels are empty until the user has
   * granted the microphone once, so call this after a successful start.
   */
  static async devices(): Promise<MicDevice[]> {
    const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.enumerateDevices) return [];
    const all = await media.enumerateDevices();
    return all
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }
}

/**
 * Speech processing is off: echo cancellation, noise suppression and auto
 * gain are built for voices and smear tones. A named device that is gone
 * falls back to the default rather than failing.
 */
async function openStream(media: MediaDevices, deviceId: string | null): Promise<MediaStream> {
  const base: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
  if (deviceId) {
    try {
      return await media.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } });
    } catch (e) {
      if (!(e instanceof DOMException) || (e.name !== "OverconstrainedError" && e.name !== "NotFoundError")) throw e;
    }
  }
  return media.getUserMedia({ audio: base });
}

function release(stream: MediaStream) {
  for (const t of stream.getTracks()) {
    t.onended = null;
    t.stop();
  }
}

function describe(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone access was denied. Allow it and try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No microphone was found.";
      case "NotReadableError":
        return "The microphone is in use by another app.";
    }
    return `Could not open the microphone: ${e.message || e.name}`;
  }
  return `Could not open the microphone: ${String(e)}`;
}
