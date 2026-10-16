import { defineConfig } from "vite";
export default defineConfig({
  // Discover the worker codec before users import audio: lazy optimization
  // otherwise reloads the development page during its first ZIP export.
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm"] },
  optimizeDeps: { include: ["wasm-media-encoders"], exclude: ["onnxruntime-web"] },
  server: {
    host: "127.0.0.1",
    watch: {
      ignored: [
        "**/.local-tests/**",
        "**/.venv/**",
        "**/.model-venv/**",
        "**/.model-cache/**",
        "**/.openai/**",
        "**/docs/**",
        "**/tests/**",
        "**/tools/**",
      ],
    },
  },
  build: { target: "es2022" },
  worker: { format: "es" },
  base: "./",
});
