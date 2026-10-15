/** All PCM processing and encoding stays on the device. */
export function trimAudio(buffer, start, end, context) {
  start = Math.max(0, Math.min(buffer.duration, Number(start)));
  end = Math.min(buffer.duration, Number(end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 5)
    throw new Error("Choose at least 5 seconds of audio.");
  const first = Math.floor(start * buffer.sampleRate),
    last = Math.floor(end * buffer.sampleRate);
  const clipped = context.createBuffer(
    Math.min(2, buffer.numberOfChannels),
    last - first,
    buffer.sampleRate,
  );
  for (let c = 0; c < clipped.numberOfChannels; c++)
    clipped.copyToChannel(buffer.getChannelData(c).subarray(first, last), c);
  return clipped;
}
export function encodeOgg(buffer, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./encode.worker.js", import.meta.url), {
      type: "module",
    });
    const channels = Array.from(
      { length: Math.min(2, buffer.numberOfChannels) },
      (_, i) => buffer.getChannelData(i).slice(),
    );
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) onProgress(data.progress);
      else {
        worker.terminate();
        data.error
          ? reject(new Error(data.error))
          : resolve(new Uint8Array(data.bytes));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Audio encoder failed."));
    };
    worker.postMessage(
      { channels, sampleRate: buffer.sampleRate },
      channels.map((x) => x.buffer),
    );
  });
}
export function makeCover(title = "OPEN BEATMAP") {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#101214";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "#fa7058";
  g.lineWidth = 4;
  for (let i = 0; i < 10; i++) {
    g.save();
    g.translate(256, 230);
    g.rotate(-0.4);
    const r = 40 + i * 25;
    g.strokeRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
  g.fillStyle = "#101214";
  g.fillRect(24, 370, 464, 118);
  g.fillStyle = "#fff";
  g.font = "bold 28px sans-serif";
  const words = title.slice(0, 44).split(" ");
  let line = "",
    y = 413;
  for (const w of words) {
    if (g.measureText(line + w).width > 440) {
      g.fillText(line, 34, y);
      y += 34;
      line = "";
    }
    line += w + " ";
  }
  g.fillText(line, 34, y);
  return new Promise((resolve) =>
    c.toBlob(
      async (blob) => resolve(new Uint8Array(await blob.arrayBuffer())),
      "image/png",
    ),
  );
}
/** Original, deterministic demo composition. No external recording is bundled. */
export function createDemo(context) {
  const sr = 44100,
    bpm = 128,
    beat = 60 / bpm,
    duration = 64 * beat * 2;
  const b = context.createBuffer(2, Math.ceil(duration * sr), sr),
    l = b.getChannelData(0),
    r = b.getChannelData(1);
  let seed = 721;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return ((seed >>> 0) / 4294967296) * 2 - 1;
  };
  function add(t, len, fn, pan = 0) {
    const s = Math.floor(t * sr),
      n = Math.min(Math.floor(len * sr), l.length - s);
    for (let i = 0; i < n; i++) {
      const v = fn(i / sr, i / n);
      l[s + i] += v * (1 - pan * 0.3);
      r[s + i] += v * (1 + pan * 0.3);
    }
  }
  const bass = [110, 110, 130.8128, 98],
    melody = [440, 523.25, 659.25, 587.33, 523.25, 440, 392, 329.63];
  for (let k = 0; k < 128; k++) {
    const t = k * beat,
      section = Math.floor(k / 32),
      power =
        section === 0 ? 0.65 : section === 1 ? 0.8 : section === 2 ? 1 : 0.75;
    add(
      t,
      0.28,
      (s) =>
        Math.sin(2 * Math.PI * (48 * s + 7 * (1 - Math.exp(-s * 35)))) *
        Math.exp(-s * 18) *
        0.6 *
        power,
    );
    if (k % 2 === 1)
      add(t, 0.16, (s) => rand() * Math.exp(-s * 35) * 0.19 * power);
    for (let j = 0; j < (section === 2 ? 4 : 2); j++)
      add(
        t + (j * beat) / (section === 2 ? 4 : 2),
        0.06,
        (s) => rand() * Math.exp(-s * 100) * 0.06,
        j % 2 ? -0.5 : 0.5,
      );
    const f = bass[Math.floor(k / 8) % 4];
    add(
      t,
      beat * 0.82,
      (s, p) => Math.sin(2 * Math.PI * f * s) * Math.sin(Math.PI * p) * 0.16,
    );
    if (k >= 16) {
      const note = melody[Math.floor(k / 2) % 8];
      add(
        t,
        beat * 0.8,
        (s, p) =>
          (Math.sin(2 * Math.PI * note * s) +
            0.2 * Math.sin(2 * Math.PI * note * 2 * s)) *
          Math.exp(-s * 10) *
          0.105,
        Math.sin(k) * 0.7,
      );
    }
    if (k % 8 === 0) {
      const f = bass[Math.floor(k / 8) % 4];
      add(
        t,
        beat * 7.8,
        (s, p) =>
          (Math.sin(2 * Math.PI * f * 2 * s) +
            Math.sin(2 * Math.PI * f * 2.5 * s) +
            Math.sin(2 * Math.PI * f * 3 * s)) *
          0.035 *
          Math.sin(Math.PI * p),
      );
    }
  }
  for (let i = 0; i < l.length; i++) {
    const t = i / sr,
      bar = t / (beat * 32);
    const dynamics =
      bar < 1
        ? 0.26
        : bar < 2
          ? 0.3 + (bar - 1) * 0.42
          : bar < 3
            ? 1
            : bar < 3.5
              ? 0.23
              : 0.85;
    const fade = Math.min(1, i / (sr * 0.02), (l.length - i) / (sr * 0.3));
    l[i] = Math.tanh(l[i]) * fade * dynamics;
    r[i] = Math.tanh(r[i]) * fade * dynamics;
  }
  return b;
}
export class Transport {
  constructor(context, onChange = () => {}) {
    this.context = context;
    this.onChange = onChange;
    this.position = 0;
    this.rate = 1;
    this.playing = false;
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    this.gain.gain.value = 0.6;
  }
  load(buffer) {
    this.pause();
    this.buffer = buffer;
    this.position = 0;
    this.onChange();
  }
  get time() {
    return this.playing
      ? Math.min(
          this.buffer.duration,
          this.position + (this.context.currentTime - this.started) * this.rate,
        )
      : this.position;
  }
  async play() {
    if (!this.buffer) return;
    await this.context.resume();
    if (this.time >= this.buffer.duration - 0.01) this.position = 0;
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.value = this.rate;
    this.source.connect(this.gain);
    this.started = this.context.currentTime;
    this.playing = true;
    this.source.onended = () => {
      if (this.playing && this.time >= this.buffer.duration - 0.05) {
        this.position = this.buffer.duration;
        this.playing = false;
        this.onChange();
      }
    };
    this.source.start(0, this.position);
    this.onChange();
  }
  pause() {
    if (this.playing) {
      this.position = this.time;
      this.playing = false;
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
    }
    this.onChange();
  }
  seek(t) {
    const playing = this.playing;
    this.pause();
    this.position = Math.max(0, Math.min(this.buffer?.duration || 0, t));
    if (playing) this.play();
    else this.onChange();
  }
  setRate(rate) {
    const playing = this.playing;
    this.pause();
    this.rate = rate;
    if (playing) this.play();
  }
}
