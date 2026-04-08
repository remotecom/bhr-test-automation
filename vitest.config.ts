import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

// Load .env file
dotenv.config();

export default defineConfig({
  test: {
    testTimeout: 60_000, // 60s per test — these hit real APIs
    hookTimeout: 30_000,
    fileParallelism: false, // files share sandbox state — must run sequentially
    sequence: { concurrent: false },
    reporters: [["./src/reporter.ts"]],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
