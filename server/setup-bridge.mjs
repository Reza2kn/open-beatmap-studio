import { spawnSync } from "node:child_process";
import { join } from "node:path";
const windows = process.platform === "win32";
const python = process.env.BEATMAP_PYTHON || (windows ? "python" : "python3");
function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.error || r.status !== 0) {
    console.error(r.error?.message || `${cmd} exited ${r.status}`);
    process.exit(r.status || 1);
  }
}
run(python, ["-m", "venv", ".venv"]);
run(
  join(".venv", windows ? "Scripts" : "bin", windows ? "python.exe" : "python"),
  ["-m", "pip", "install", "-r", "server/requirements.txt"],
);
console.log(
  "Local downloader installed. FFmpeg must also be on PATH. Run npm run bridge.",
);
