import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location("relay", Path(__file__).parents[1] / "server/youtube-relay.py")
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)


class RelayTests(unittest.TestCase):
    def test_ids_cannot_become_options_urls_or_paths(self):
        with patch.object(relay.subprocess, "run") as run:
            for value in ["--exec=touch", "https://example.com/", "../../etc/passwd", None, 42]:
                with self.assertRaises(ValueError):
                    relay.download(value, "/unused")
            run.assert_not_called()

    def test_audio_metadata_cannot_escape_directory_or_exceed_bounds(self):
        for extension, duration, size in [("../secret", 196, 3), ("webm", 601, 3), ("webm", 196, relay.MAX_BYTES + 1)]:
            with tempfile.TemporaryDirectory() as directory:
                (Path(directory) / "audio.info.json").write_text(json.dumps({"ext": extension, "duration": duration}))
                with (Path(directory) / "audio.webm").open("wb") as audio:
                    audio.seek(size - 1)
                    audio.write(b"x")
                with patch.object(relay.subprocess, "run") as run:
                    run.return_value.returncode = 0
                    with self.assertRaises(ValueError):
                        relay.download("206atvk4uyE", directory)

    def test_authentication_and_invalid_input_precede_downloader(self):
        server = relay.ThreadingHTTPServer(("127.0.0.1", 0), relay.Handler)
        server.secret = "s" * 64
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/audio"
        try:
            with patch.object(relay, "download") as download:
                for secret, video, expected in [("wrong", "206atvk4uyE", 401), (server.secret, "not-valid", 400)]:
                    request = Request(url, data=json.dumps({"videoId": video}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + secret})
                    with self.assertRaises(HTTPError) as error:
                        urlopen(request, timeout=5)
                    self.assertEqual(error.exception.code, expected)
                    error.exception.close()
                download.assert_not_called()
                relay.RECENT.clear()
                relay.SLOTS.acquire()
                relay.SLOTS.acquire()
                try:
                    request = Request(url, data=json.dumps({"videoId": "206atvk4uyE"}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + server.secret})
                    with self.assertRaises(HTTPError) as error:
                        urlopen(request, timeout=5)
                    self.assertEqual(error.exception.code, 429)
                    error.exception.close()
                    self.assertEqual(len(relay.RECENT), 0)
                    download.assert_not_called()
                finally:
                    relay.SLOTS.release()
                    relay.SLOTS.release()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
