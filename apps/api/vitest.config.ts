/**
 * Vitest configuration for the AnimBook API.
 *
 * Runs the Node-native tests under `apps/api/tests/*.test.mjs` plus any
 * future Vitest-style tests. Install with:
 *
 *     npm install -D vitest @vitest/coverage-v8
 *
 * Until Vitest is installed, the standalone `node --test apps/api/tests/*.test.mjs`
 * command is the entry-point. Both share the same files. When Vitest lands,
 * `npm run test -w @animbook/api` will run them through this config.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/services/**/*.ts", "src/middleware/**/*.ts", "src/cache/**/*.ts"],
      exclude: ["src/**/*.d.ts"]
    },
    globals: false,
    reporters: ["default"]
  }
});
