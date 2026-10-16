import { defineConfig } from "vite";
import {sites} from "./build/sites-vite-plugin.ts";
export default defineConfig(async()=>{
  process.env.CLOUDFLARE_CF_FETCH_ENABLED??='false';
  process.env.WRANGLER_SEND_METRICS??='false';
  process.env.WRANGLER_WRITE_LOGS??='false';
  process.env.WRANGLER_LOG_PATH??='.wrangler/logs';
  process.env.WRANGLER_REGISTRY_PATH??='.wrangler/dev-registry';
  process.env.MINIFLARE_REGISTRY_PATH??='.wrangler/registry';
  const {cloudflare}=await import('@cloudflare/vite-plugin');
  return {
  plugins:[sites({mockAuth:false}),cloudflare({configPath:'wrangler.jsonc',viteEnvironment:{name:'server'},inspectorPort:false})],
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
  };
});
