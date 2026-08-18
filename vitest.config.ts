import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // .claude/worktrees (git worktrees) and .agents (vendored skills) contain
    // source copies whose tests would run against the root node_modules.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.claude/**",
      "**/.agents/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Mirrors `vite.config.ts`. The workspace package has no build output,
      // so without this any test that reaches it — directly or through a lazy
      // import — fails to resolve at runtime rather than at type-check time.
      "relay-auth-manager": path.resolve(
        import.meta.dirname,
        "./packages/relay-auth-manager/src/index.ts",
      ),
      // Same reason. The app does not import Hex — it is a standalone daemon —
      // but its own tests resolve through the package name.
      "nostr-hex": path.resolve(
        import.meta.dirname,
        "./packages/hex/src/index.ts",
      ),
    },
  },
});
