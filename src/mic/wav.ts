// A minimal WAV codec for recordings of the real instrument (DESIGN.md
// §16.10): 16-bit PCM mono out, and enough of a reader to load fixtures in
// tests. Nothing else is needed, so nothing else is here.

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  writeAscii(v, 0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, "WAVE");
  writeAscii(v, 12, "fmt ");
  v.setUint32(16, 16, true); // chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeAscii(v, 36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export interface WavData {
  sampleRate: number;
  /** The first channel, -1..1. */
  samples: Float32Array;
}

/** Reads 16-bit PCM or 32-bit float WAV; a multi-channel file yields its first channel. */
export function decodeWav(bytes: Uint8Array): WavData {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(v, 0, 4) !== "RIFF" || readAscii(v, 8, 4) !== "WAVE") throw new Error("not a WAV file");
  let format = 0;
  let channels = 1;
  let sampleRate = 0;
  let bits = 0;
  let pos = 12;
  while (pos + 8 <= v.byteLength) {
    const id = readAscii(v, pos, 4);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt ") {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
    } else if (id === "data") {
      if (!sampleRate) throw new Error("WAV data before fmt");
      const end = Math.min(body + size, v.byteLength);
      const bytesPerSample = bits / 8;
      const frames = Math.floor((end - body) / (bytesPerSample * channels));
      const samples = new Float32Array(frames);
      if (format === 1 && bits === 16) {
        for (let i = 0; i < frames; i++) samples[i] = v.getInt16(body + i * channels * 2, true) / 0x8000;
      } else if (format === 3 && bits === 32) {
        for (let i = 0; i < frames; i++) samples[i] = v.getFloat32(body + i * channels * 4, true);
      } else if (format === 1 && bits === 24) {
        for (let i = 0; i < frames; i++) {
          const o = body + i * channels * 3;
          const raw = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
          samples[i] = raw / 0x800000;
        }
      } else {
        throw new Error(`unsupported WAV format ${format} at ${bits} bits`);
      }
      return { sampleRate, samples };
    }
    pos = body + size + (size & 1);
  }
  throw new Error("WAV has no data chunk");
}

function writeAscii(v: DataView, offset: number, s: string) {
  for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
}

function readAscii(v: DataView, offset: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(offset + i));
  return s;
}
