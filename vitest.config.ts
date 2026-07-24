import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.mjs",
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
    passWithNoTests: false,
  },
});
