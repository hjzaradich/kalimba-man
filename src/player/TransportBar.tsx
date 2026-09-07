import { useEffect, useState } from "react";
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
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Every control from DESIGN.md §8. */
export function TransportBar({ transport, enabled, sections = [], onPlayToggle, handHints, onHandHints, metronome, onMetronome, practice, onWaitMode, onRecord, onCancelRecord }: Props) {
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
        <button
          className={practice.mode === "wait" ? "is-on" : ""}
          disabled={!enabled || recording}
          onClick={() => onWaitMode(practice.mode !== "wait")}
          title="Pause at each note until you press Space or click"
        >
          Wait for me
        </button>
        {recording ? (
          <button className="danger" onClick={onCancelRecord} title="Stop without saving">
            Cancel ({practice.next}/{practice.total})
          </button>
        ) : (
          <button disabled={!enabled} onClick={onRecord} title="Tap Space or click once per note; the song takes your rhythm">
            Record rhythm
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
