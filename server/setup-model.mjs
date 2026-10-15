import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const environment = join(root, '.model-venv');
const python = join(environment, windows ? 'Scripts' : 'bin', windows ? 'python.exe' : 'python');
const requirements = join(root, 'server', 'model-requirements.txt');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || `${command} exited ${result.status}`);
}
function available(command, args = ['--version']) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'pipe' });
  return !result.error && result.status === 0;
}
try {
  const uv = available('uv');
  if (!existsSync(python)) {
    if (process.env.BEATMAP_MODEL_PYTHON) {
      run(process.env.BEATMAP_MODEL_PYTHON, ['-m', 'venv', environment]);
    } else if (uv) {
      run('uv', ['venv', environment, '--python', '3.12']);
    } else {
      const candidates = windows ? ['python3.12', 'python3.11', 'python'] : ['python3.12', 'python3.11', 'python3'];
      const candidate = candidates.find(command => available(command, ['-c', 'import sys;sys.exit(0 if (3,10)<=sys.version_info[:2]<(3,14) else 1)']));
      if (!candidate) throw new Error('Install Python 3.12 or uv, or set BEATMAP_MODEL_PYTHON to a Python 3.10–3.13 executable.');
      run(candidate, ['-m', 'venv', environment]);
    }
  }
  run(python, ['-c', 'import sys;assert (3,10)<=sys.version_info[:2]<(3,14), "Use Python 3.10–3.13 for the pinned CPU model runtime."']);
  // PyPI's Linux/Windows torch wheels can pull large CUDA dependencies. Use
  // PyTorch's official CPU index first; local +cpu versions satisfy the pins.
  if (process.platform !== 'darwin') {
    const torchArgs = ['--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.8.0', 'torchaudio==2.8.0'];
    if (uv) run('uv', ['pip', 'install', '--python', python, ...torchArgs]);
    else run(python, ['-m', 'pip', 'install', ...torchArgs]);
  }
  if (uv) run('uv', ['pip', 'install', '--python', python, '-r', requirements]);
  else run(python, ['-m', 'pip', 'install', '-r', requirements]);
  run(python, [join(root, 'server', 'beat-model.py'), '--download', '--separate-drums']);
  console.log('Beat This! small0 + htdemucs installed locally. Beat/drum inference runs on your CPU and stays on this computer.');
  console.log('Run npm run bridge, then connect the studio to the local bridge.');
} catch (error) {
  console.error(`Model setup failed: ${error.message}`);
  process.exitCode = 1;
}
