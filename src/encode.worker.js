import { createOggEncoder } from "wasm-media-encoders";
self.onmessage = async ({ data: { channels, sampleRate } }) => {
  try {
    const encoder = await createOggEncoder();
    encoder.configure({ sampleRate, channels: channels.length, vbrQuality: 5 });
    const chunks = [];
    let total = 0;
    const step = 16384;
    for (let i = 0; i < channels[0].length; i += step) {
      const bytes = encoder
        .encode(channels.map((c) => c.subarray(i, i + step)))
        .slice();
      chunks.push(bytes);
      total += bytes.length;
      if (i % (step * 16) === 0)
        self.postMessage({ progress: i / channels[0].length });
    }
    const tail = encoder.finalize().slice();
    chunks.push(tail);
    total += tail.length;
    const result = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) {
      result.set(chunk, cursor);
      cursor += chunk.length;
    }
    self.postMessage({ bytes: result.buffer }, [result.buffer]);
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
