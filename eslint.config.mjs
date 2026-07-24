import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".git/**",
      "**/dist/**",
      "coverage/**",
      "**/.next/**",
      "**/migrations/meta/**",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
