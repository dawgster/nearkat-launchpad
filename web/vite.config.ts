import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Stops a production build while a dev wallet key is configured. Vite copies
 * VITE_ variables into the bundle, where anyone could read the key.
 */
function refuseDevWalletInBuild(): Plugin {
  return {
    name: "refuse-dev-wallet-in-build",
    apply: "build",
    config(_config, { mode }) {
      const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
      if (env.VITE_DEV_WALLET_KEY) {
        throw new Error(
          "VITE_DEV_WALLET_KEY is set. Remove it before building: the key would be readable in the bundle.",
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [refuseDevWalletInBuild(), react(), tailwindcss()],
  // The art module lives beside the app, shared with the keeper.
  server: { port: 3000, strictPort: true, fs: { allow: [".."] } },
  // onnxruntime-web finds its wasm beside its own module (new URL(..., import.meta.url)):
  // pre-bundling would move the module away from it, so Vite serves the package as is.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
  },
});
