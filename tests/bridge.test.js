import test from "node:test";
import assert from "node:assert/strict";
import { youtubeUrl, createBridge } from "../server/bridge.mjs";
test("YouTube URL normalization rejects non-YouTube and argument injection", () => {
  assert.equal(
    youtubeUrl("https://youtu.be/dQw4w9WgXcQ?t=3"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.equal(
    youtubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  for (const u of [
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "file:///etc/passwd",
    "--exec=bad",
    "https://youtube.com/playlist?list=abc",
    "https://youtube.com/watch?v=--exec=bad",
    "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
  ])
    assert.throws(() => youtubeUrl(u));
});
test("Bridge requires temporary token and rejects arbitrary origins", async () => {
  const { server } = createBridge({ token: "test-token" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(root + "/health")).status, 401);
    assert.equal(
      (
        await fetch(root + "/health", {
          headers: {
            Authorization: "Bearer test-token",
            Origin: "https://evil.example",
          },
        })
      ).status,
      403,
    );
    const good = await fetch(root + "/health", {
      headers: {
        Authorization: "Bearer test-token",
        Origin: "http://localhost:5173",
      },
    });
    assert.equal(good.status, 200);
    assert.equal((await good.json()).ready, true);
    const invalid = await fetch(root + "/import", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
