import { describe, expect, it } from "vitest";
import { parseNotation } from "../model/notation";
import { songFromText } from "../model/song";
import { Practice, type PracticeEvent } from "./practice";
import { Scheduler } from "./scheduler";
import { Transport } from "./transport";

function setup(text = "1 2 (3 5) 4", bpm = 60) {
  let real = 50;
  const clock = () => real;
  const transport = new Transport(clock);
  const scheduler = new Scheduler(transport, null, null);
  const song = songFromText(text, { title: "t", bpm }, parseNotation(text).events);
  const events: PracticeEvent[] = [];
  const practice = new Practice(transport, scheduler, () => null, (e) => events.push(e), clock);
  transport.setDuration(10);
  scheduler.setSong(song);
  practice.setSong(song);
  return { transport, practice, song, events, advance: (s: number) => (real += s) };
}

describe("wait mode", () => {
  it("pauses at each group until hit, then resumes", () => {
    const { transport, practice, advance } = setup();
    practice.setMode("wait");
    expect(practice.state).toMatchObject({ mode: "wait", waiting: false, next: 0, total: 4 });

    transport.play();
    practice.tick(); // at t=0 the first group is due
    expect(practice.state.waiting).toBe(true);
    expect(transport.isPlaying).toBe(false);
    expect(transport.now()).toBe(0);
    expect(practice.pendingNotes).toEqual([0]);

    expect(practice.hit()).toBe(true);
    expect(transport.isPlaying).toBe(true);
    expect(practice.state).toMatchObject({ waiting: false, next: 1 });

    advance(0.5);
    practice.tick();
    expect(practice.state.waiting).toBe(false);
    advance(0.6); // now 1.1s, past the second group at 1.0
    practice.tick();
    expect(practice.state.waiting).toBe(true);
    expect(transport.now()).toBe(1); // snapped back to the note
  });

  it("treats a chord as one hit and ignores hits while not waiting", () => {
    const { transport, practice, advance } = setup();
    practice.setMode("wait");
    expect(practice.hit()).toBe(false);
    transport.play();
    practice.tick();
    practice.hit();
    advance(1.01);
    practice.tick();
    practice.hit(); // group 2
    advance(1.01);
    practice.tick();
    expect(practice.pendingNotes).toEqual([2, 3]); // the chord
    practice.hit();
    expect(practice.state.next).toBe(3);
  });

  it("follows a manual seek", () => {
    const { transport, practice } = setup();
    practice.setMode("wait");
    transport.seek(2.9);
    expect(practice.state.next).toBe(3);
  });

  it("stops holding when switched off", () => {
    const { transport, practice, advance } = setup();
    practice.setMode("wait");
    transport.play();
    practice.tick();
    practice.setMode("off");
    expect(practice.state.waiting).toBe(false);
    transport.play();
    advance(5);
    practice.tick();
    expect(transport.isPlaying).toBe(true);
  });
});

describe("record mode", () => {
  it("collects one tap per group and reports them at the end", () => {
    const { transport, practice, events, advance } = setup();
    practice.setMode("record");
    expect(practice.state).toMatchObject({ mode: "record", waiting: true, next: 0 });
    expect(transport.isPlaying).toBe(false);

    practice.hit();
    expect(transport.now()).toBe(1); // jumped to the next group's time
    advance(0.7);
    practice.hit();
    advance(0.7);
    practice.hit();
    advance(0.3);
    practice.hit();

    const recorded = events.find((e) => e.type === "recorded");
    expect(recorded).toBeTruthy();
    const taps = recorded && recorded.type === "recorded" ? recorded.taps : [];
    expect(taps).toHaveLength(4);
    [50, 50.7, 51.4, 51.7].forEach((t, i) => expect(taps[i]).toBeCloseTo(t, 6));
    expect(practice.state.waiting).toBe(false);
  });
});
