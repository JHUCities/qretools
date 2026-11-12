import { defineConfig } from "vitest/config";

// The CLI's tests make git repositories and run real builds and real Node processes. On a
// CI runner several took just over vitest's default 5s, so every test here has 30s.
export default defineConfig({ test: { testTimeout: 30_000 } });
