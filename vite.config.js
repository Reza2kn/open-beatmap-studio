import { defineConfig } from "vite";
export default defineConfig({
  server: {
    host: "127.0.0.1",
    watch: {
      ignored: [
        "**/.local-tests/**",
        "**/.venv/**",
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
