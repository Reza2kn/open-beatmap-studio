"""Small authenticated download origin for hosts whose IPs YouTube refuses.

This runs on infrastructure owned by the studio operator, never on a user's
computer. It accepts video IDs only and keeps media in a temporary directory.
"""
import hmac
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

MAX_BYTES = 100 * 1024 * 1024
SLOTS = threading.BoundedSemaphore(2)
RECENT = deque()
LOCK = threading.Lock()


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", value) is not None


def download(video_id, directory):
    if not valid_id(video_id):
        raise ValueError("Invalid video ID.")
    result = subprocess.run(
        [sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-cache-dir", "--no-playlist",
         "--extractor-args", "youtube:player_client=visionos",
         "--quiet", "--no-progress", "--no-warnings", "--socket-timeout", "12",
         "--retries", "1", "--fragment-retries", "1", "--extractor-retries", "1", "--abort-on-unavailable-fragments",
         "--max-filesize", str(MAX_BYTES), "--match-filter",
         "duration >= 5 & duration <= 600 & !is_live", "--write-info-json",
         "-f", "bestaudio[ext=webm][protocol=https]/bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]",
         "-o", str(Path(directory) / "audio.%(ext)s"),
         "https://www.youtube.com/watch?v=" + video_id],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=90, check=False,
    )
    if result.returncode:
        raise ValueError("YouTube could not download this public video.")
    metadata = Path(directory) / "audio.info.json"
    if not metadata.is_file() or metadata.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Choose a public video between 5 seconds and 10 minutes.")
    info = json.loads(metadata.read_text())
    duration = float(info.get("duration") or 0)
    if not math.isfinite(duration) or not 5 <= duration <= 600 or info.get("is_live"):
        raise ValueError("Choose a public video between 5 seconds and 10 minutes.")
    extension = info.get("ext")
    mime = {"webm": "audio/webm", "m4a": "audio/mp4", "ogg": "audio/ogg", "opus": "audio/ogg"}.get(extension)
    if not mime:
        raise ValueError("This video does not offer a supported audio format.")
    path = Path(directory) / ("audio." + extension)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("The audio is empty or exceeds 100 MB.")
    return path, mime, str(info.get("title") or "YouTube track")[:300], duration


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "AudioOrigin"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *args):
        # Neither credentials, titles, signed URLs nor media enter request logs.
        pass

    def authenticated(self):
        expected = "Bearer " + self.server.secret
        return hmac.compare_digest(self.headers.get("Authorization", "").encode(), expected.encode())

    def error(self, message, status):
        body = json.dumps({"error": message}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.authenticated():
            return self.error("Unauthorized.", 401)
        self.error("ready" if self.path == "/health" else "Not found.", 200 if self.path == "/health" else 404)

    def do_POST(self):
        if not self.authenticated():
            return self.error("Unauthorized.", 401)
        if self.path != "/audio":
            return self.error("Not found.", 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get_content_type() != "application/json":
                return self.error("Expected a video ID.", 400)
            video_id = json.loads(self.rfile.read(length)).get("videoId")
            if not valid_id(video_id):
                return self.error("Expected a video ID.", 400)
        except (ValueError, TypeError, AttributeError):
            return self.error("Expected a video ID.", 400)
        if not SLOTS.acquire(blocking=False):
            return self.error("The importer is busy. Try again shortly.", 429)
        with LOCK:
            now = time.monotonic()
            while RECENT and RECENT[0] < now - 600:
                RECENT.popleft()
            if len(RECENT) >= 24:
                SLOTS.release()
                return self.error("Too many imports. Try again shortly.", 429)
            RECENT.append(now)
        headers_sent = False
        try:
            with tempfile.TemporaryDirectory(prefix="beatmap-audio-") as directory:
                path, mime, title, duration = download(video_id, directory)
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(path.stat().st_size))
                self.send_header("Cache-Control", "private, no-store")
                self.send_header("X-Track-Title", quote(title, safe=""))
                self.send_header("X-Track-Duration", str(duration))
                self.send_header("X-Audio-Extension", "m4a" if mime == "audio/mp4" else "webm" if mime == "audio/webm" else "ogg")
                self.send_header("Connection", "close")
                self.end_headers()
                headers_sent = True
                self.close_connection = True
                with path.open("rb") as audio:
                    while chunk := audio.read(64 * 1024):
                        self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except ValueError as error:
            if not headers_sent:
                self.error(str(error), 422)
        except subprocess.TimeoutExpired:
            if not headers_sent:
                self.error("YouTube took too long to respond. Try again.", 504)
        except Exception:
            if not headers_sent:
                self.error("The download service is temporarily unavailable.", 502)
        finally:
            SLOTS.release()


def main():
    secret = os.environ.get("YOUTUBE_ORIGIN_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("Set a strong server-only YOUTUBE_ORIGIN_SECRET.")
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("YOUTUBE_ORIGIN_PORT", "48721"))), Handler)
    server.daemon_threads = True
    server.secret = secret
    server.serve_forever()


if __name__ == "__main__":
    main()
