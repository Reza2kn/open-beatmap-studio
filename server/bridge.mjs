import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
const localDownloader = join(
  process.cwd(),
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp",
);
const downloader =
  process.env.BEATMAP_YTDLP ||
  (existsSync(localDownloader) ? localDownloader : "yt-dlp");
export function youtubeUrl(input) {
  const u = new URL(input);
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw new Error("Use an HTTPS YouTube video URL.");
  let id;
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "music.youtube.com",
      "m.youtube.com",
    ].includes(u.hostname)
  ) {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else if (/^\/(shorts|live)\//.test(u.pathname))
      id = u.pathname.split("/")[2];
  } else if (u.hostname === "youtu.be") id = u.pathname.slice(1);
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || ""))
    throw new Error("Enter a single YouTube video URL, not a playlist.");
  return `https://www.youtube.com/watch?v=${id}`;
}
function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, {
      signal,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-4000)));
    p.on("error", (e) =>
      reject(
        new Error(
          e.code === "ENOENT"
            ? `Downloader could not start. Run npm run bridge:setup and ensure FFmpeg is installed. See README.md.`
            : e.message,
        ),
      ),
    );
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              stderr.replace(/https?:\/\/\S+/g, "[source]").slice(-1000) ||
                `Downloader exited ${code}.`,
            ),
          ),
    );
  });
}
export function createBridge({
  token = randomBytes(24).toString("hex"),
  allowedOrigin = "https://open-beatmap-studio.frostymoose128.chatgpt.site",
} = {}) {
  let active = false;
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    if (origin && origin !== allowedOrigin && !local) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Expose-Headers", "X-Track-Title");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const auth = Buffer.from(req.headers.authorization || ""),
      expected = Buffer.from(`Bearer ${token}`);
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      json(401, {
        error:
          "Invalid bridge key. Copy the temporary key from npm run bridge.",
      });
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      json(200, { ready: true, local: true });
      return;
    }
    if (req.method !== "POST" || req.url !== "/import") {
      json(404, { error: "Unknown route." });
      return;
    }
    if (active) {
      json(409, {
        error: "An import is already running. Wait for it to finish.",
      });
      return;
    }
    active = true;
    let directory, controller, timer;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) throw new Error("Request is too large.");
      }
      const url = youtubeUrl(JSON.parse(body).url);
      directory = await mkdtemp(join(tmpdir(), "open-beatmap-"));
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 180000);
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      await run(
        downloader,
        [
          "--js-runtimes",
          "node",
          "--ignore-config",
          "--no-playlist",
          "--no-progress",
          "--max-filesize",
          "100M",
          "--match-filter",
          "duration <= 600 & !is_live",
          "--socket-timeout",
          "20",
          "--retries",
          "1",
          "--format",
          "bestaudio/best",
          "--extract-audio",
          "--audio-format",
          "flac",
          "--audio-quality",
          "5",
          "--write-info-json",
          "--no-warnings",
          "-o",
          join(directory, "track.%(ext)s"),
          "--",
          url,
        ],
        controller.signal,
      );
      const files = await readdir(directory),
        audio = files.find((f) => f.endsWith(".flac"));
      if (!audio)
        throw new Error(
          "No audio was produced. The video may be too long or unavailable.",
        );
      if ((await stat(join(directory, audio))).size > 100 * 1024 * 1024)
        throw new Error("Converted audio exceeds 100 MB.");
      const metadata = JSON.parse(
        await readFile(join(directory, "track.info.json"), "utf8"),
      );
      const bytes = await readFile(join(directory, audio));
      res.writeHead(200, {
        "Content-Type": "audio/flac",
        "Content-Length": bytes.length,
        "X-Track-Title": encodeURIComponent(
          (metadata.title || "YouTube track").slice(0, 160),
        ),
      });
      res.end(bytes);
    } catch (e) {
      if (!res.headersSent)
        json(400, {
          error:
            e.name === "AbortError"
              ? "Import timed out. Please try a shorter video."
              : e.message,
        });
    } finally {
      clearTimeout(timer);
      if (directory) await rm(directory, { recursive: true, force: true });
      active = false;
    }
  });
  return { server, token };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server, token } = createBridge();
  server.listen(4174, "127.0.0.1", () => {
    console.log("Open Beatmap local YouTube bridge: http://127.0.0.1:4174");
    console.log("Temporary bridge key (paste into the studio YouTube tab):");
    console.log(token);
    console.log(
      "Requires yt-dlp and ffmpeg. Keep this terminal open. Ctrl+C stops the bridge.",
    );
  });
}
