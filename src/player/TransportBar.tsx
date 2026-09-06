import { useEffect, useState } from "react";
import type { Transport } from "./transport";

interface Props {
  transport: Transport;
  enabled: boolean;
  onPlayToggle: () => void;
  handHints: boolean;
  onHandHints: (on: boolean) => void;
}

const LATER = "Coming in phase 3";

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Every control from DESIGN.md §8 is present so the layout is settled now.
 * Loop, metronome and wait mode are disabled until phase 3 wires them.
 */
export function TransportBar({ transport, enabled, onPlayToggle, handHints, onHandHints }: Props) {
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

  const now = transport.now();
  const duration = transport.duration;
  const playing = transport.isPlaying;

  return (
    <div className="transport">
      <button className="transport__play" onClick={onPlayToggle} disabled={!enabled} title="Space">
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="transport__time">{fmt(now)}</span>
      <input
        className="transport__seek"
        type="range"
        min={0}
        max={Math.max(duration, 0.001)}
        step={0.01}
        value={Math.min(now, duration)}
        disabled={!enabled}
        onChange={(e) => transport.seek(Number(e.target.value))}
      />
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
        <button disabled title={LATER}>Loop A</button>
        <button disabled title={LATER}>Loop B</button>
        <button disabled title={LATER}>Metronome</button>
        <button disabled title={LATER}>Wait for me</button>
        <button
          className={handHints ? "is-on" : ""}
          onClick={() => onHandHints(!handHints)}
          title="Tint each note's edge by which thumb plays it"
        >
          Hands
        </button>
      </div>
    </div>
  );
}
