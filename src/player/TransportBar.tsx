import { useEffect, useState } from "react";
import { LevelMeter } from "../mic/LevelMeter";
import type { Listener, ListenerState } from "../mic/listener";
import type { Section } from "../model/song";
import type { PracticeState } from "./practice";
import type { Transport } from "./transport";

interface Props {
  transport: Transport;
  enabled: boolean;
  /** Section markers of the current song, shown as flags on the scrub bar. */
  sections?: Section[];
  onPlayToggle: () => void;
  handHints: boolean;
  onHandHints: (on: boolean) => void;
  metronome: boolean;
  onMetronome: (on: boolean) => void;
  practice: PracticeState;
  onWaitMode: (on: boolean) => void;
  onRecord: () => void;
  onCancelRecord: () => void;
  /** The microphone; score mode is on while it is listening (DESIGN.md §16.7). */
  listener: Listener;
  mic: ListenerState;
  onScoreMode: (on: boolean) => void;
  /** The song's plucks are silent; the metronome is not part of it. */
  muted: boolean;
  onMute: (on: boolean) => void;
  /** Seconds left of a clip being saved, or null when none is. */
  clip: number | null;
  onSaveClip: () => void;
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Every control from DESIGN.md §8. */
export function TransportBar({
  transport,
  enabled,
  sections = [],
  onPlayToggle,
  handHints,
  onHandHints,
  metronome,
  onMetronome,
  practice,
  onWaitMode,
  onRecord,
  onCancelRecord,
  listener,
  mic,
  onScoreMode,
  muted,
  onMute,
  clip,
  onSaveClip,
}: Props) {
  const [, force] = useState(0);
  const [rate, setRate] = useState(transport.playbackRate);

  // Re-render on transport events and, while playing, ten times a second for the clock.
  useEffect(() => {
    const unsub = transport.subscribe(() => force((n) => n + 1));
    const id = window.setInterval(() => {
      if (transport.isPlaying) force((n) => n + 1);
    }, 100);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [transport]);

  const now = Math.max(0, transport.now()); // the lead-in shows as 0:00
  const duration = transport.duration;
  const playing = transport.isPlaying;
  const loop = transport.loop;
  const recording = practice.mode === "record";
  // Score mode is exclusive with wait and record: a performance, not a drill.
  const scoring = mic.status === "on" || mic.status === "starting";

  const setLoopPoint = (which: "a" | "b") => {
    const t = transport.now();
    const a = which === "a" ? t : (loop?.a ?? 0);
    const b = which === "b" ? t : (loop?.b ?? duration);
    if (!transport.setLoop(a, b)) transport.clearLoop();
  };

  return (
    <div className="transport">
      <button className="transport__play" onClick={onPlayToggle} disabled={!enabled || recording} title="Space">
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="transport__time">{fmt(now)}</span>
      <div className="transport__seekwrap">
        <input
          className="transport__seek"
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={0.01}
          value={Math.min(now, duration)}
          disabled={!enabled || recording}
          onChange={(e) => transport.seek(Number(e.target.value))}
        />
        {duration > 0 &&
          sections
            .filter((s) => s.marker)
            .map((s, i) => (
              <button
                key={i}
                className="transport__flag"
                style={{ left: `${(Math.min(s.time, duration) / duration) * 100}%` }}
                title={`${s.label} · ${fmt(s.time)}`}
                aria-label={`Jump to ${s.label}`}
                disabled={!enabled || recording}
                onClick={() => transport.seek(s.time)}
              />
            ))}
        {loop && duration > 0 && (
          <div
            className="transport__loop"
            style={{ left: `${(loop.a / duration) * 100}%`, width: `${((loop.b - loop.a) / duration) * 100}%` }}
            title={`Loop ${fmt(loop.a)} – ${fmt(loop.b)}`}
          />
        )}
      </div>
      <span className="transport__time">{fmt(duration)}</span>

      <label className="transport__tempo" title="Playback speed; pitch is unchanged">
        <span>Tempo</span>
        <input
          type="range"
          min={25}
          max={150}
          step={5}
          value={Math.round(rate * 100)}
          disabled={!enabled}
          onChange={(e) => {
            const r = Number(e.target.value) / 100;
            setRate(r);
            transport.setRate(r);
          }}
        />
        <span className="transport__tempo-value">{Math.round(rate * 100)}%</span>
      </label>

      <div className="transport__toggles">
        <button className={loop ? "is-on" : ""} disabled={!enabled || recording} onClick={() => setLoopPoint("a")} title="Set the loop start at the current time">
          Loop A{loop ? ` ${fmt(loop.a)}` : ""}
        </button>
        <button className={loop ? "is-on" : ""} disabled={!enabled || recording} onClick={() => setLoopPoint("b")} title="Set the loop end at the current time">
          Loop B{loop ? ` ${fmt(loop.b)}` : ""}
        </button>
        {loop && (
          <button onClick={() => transport.clearLoop()} title="Clear the loop">
            ×
          </button>
        )}
        <button className={metronome ? "is-on" : ""} disabled={!enabled} onClick={() => onMetronome(!metronome)} title="Click on every beat, accented on the bar">
          Metronome
        </button>
        <button className={muted ? "is-on" : ""} onClick={() => onMute(!muted)} title="Silence the song's notes; the metronome still clicks">
          Mute
        </button>
        <button
          className={practice.mode === "wait" ? "is-on" : ""}
          disabled={!enabled || recording || scoring}
          onClick={() => onWaitMode(practice.mode !== "wait")}
          title={scoring ? "Not available in score mode" : "Pause at each note until you press Space or click"}
        >
          Wait for me
        </button>
        {recording ? (
          <button className="danger" onClick={onCancelRecord} title="Stop without saving">
            Cancel ({practice.next}/{practice.total})
          </button>
        ) : (
          <button disabled={!enabled || scoring} onClick={onRecord} title={scoring ? "Not available in score mode" : "Tap Space or click once per note; the song takes your rhythm"}>
            Record rhythm
          </button>
        )}
        <button
          className={scoring ? "is-on" : ""}
          disabled={recording || mic.status === "starting"}
          onClick={() => onScoreMode(!scoring)}
          title={mic.error ?? "Listen to your kalimba through the microphone"}
        >
          {mic.status === "starting" ? "Starting mic…" : "Score mode"}
        </button>
        {scoring && <LevelMeter listener={listener} />}
        {scoring && (
          <button disabled={clip !== null || mic.status !== "on"} onClick={onSaveClip} title="Save 20 seconds of what the microphone hears, for tuning the detector">
            {clip !== null ? `Recording ${clip}s…` : "Save clip"}
          </button>
        )}
        <button
          className={handHints ? "is-on" : ""}
          disabled={!enabled}
          onClick={() => onHandHints(!handHints)}
          title="Tint each note's edge by which thumb plays it"
        >
          Hands
        </button>
      </div>
    </div>
  );
}
