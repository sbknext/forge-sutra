import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run .test.ts files under tests/ but NOT inside fixtures/ (those are data, not runnable tests)
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/fixtures/**"],
    // Use node environment (no browser DOM needed)
    environment: "node",
  },
  // Vitest uses esbuild to transpile TS — no tsc needed at test time.
  // The .js extensions in ESM imports are resolved correctly by vitest's resolver.
  esbuild: {
    // Keep strict semantics consistent with tsconfig
    target: "es2022",
  },
});
