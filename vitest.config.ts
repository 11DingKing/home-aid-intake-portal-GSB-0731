import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Domain + integration tests share a single SQLite test db; run serially.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    setupFiles: ["tests/setup/vitest.setup.ts"],
    globalSetup: ["tests/setup/globalSetup.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
