// The microphone pump (DESIGN.md §16.4). Runs on the audio thread and does
// one thing: gathers the input into fixed-size hops and posts each one to
// the main thread stamped with the AudioContext frame of its first sample.
// No analysis happens here; the detector is a pure module the tests can
// drive, and this file stays plain JavaScript so the bundler has nothing
// to do with it beyond serving it by URL.
//
// Message shape: { frame: number, samples: Float32Array } with the buffer
// transferred, not copied. The frame divided by the context's sample rate
// is the hop's start time on the transport's clock.

class Pump extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const hop = options && options.processorOptions && options.processorOptions.hop;
    this.hop = hop > 0 ? hop : 512;
    this.buf = new Float32Array(this.hop);
    this.fill = 0;
    this.startFrame = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input yet (the stream is still connecting): stay alive.
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      if (this.fill === 0) this.startFrame = currentFrame + i;
      this.buf[this.fill++] = channel[i];
      if (this.fill === this.hop) {
        this.port.postMessage({ frame: this.startFrame, samples: this.buf }, [this.buf.buffer]);
        this.buf = new Float32Array(this.hop);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("kalimba-pump", Pump);
