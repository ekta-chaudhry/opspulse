# OpsPulse Workspace Scaffold Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a reproducible pnpm TypeScript workspace in which the contracts, domain, and database packages build, lint, typecheck, and test on Node.js 24.

**Architecture:** TypeScript build project references establish package order. Separate package typecheck configs include tests, while build configs emit only production source. This slice creates real cross-package exports and tests but claims no product capability.

**Tech Stack:** Node.js 24.18.0, TypeScript 6.0.3, pnpm 10.30.3, ESLint 10.7.0, typescript-eslint 8.65.0, Vitest 4.1.10.

---

### Task 1: Create The Reproducible Workspace

**Files:**
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/tsconfig.build.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/index.test.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/tsconfig.build.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/src/index.test.ts`
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/tsconfig.build.json`
- Create: `packages/database/src/index.ts`
- Create: `packages/database/src/index.test.ts`

- [ ] **Step 1: Pin runtime tooling**

Create `.nvmrc` containing `24.18.0` and `.npmrc` containing `engine-strict=true`.

- [ ] **Step 2: Create the root package manifest**

```json
{
  "name": "opspulse",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "engines": { "node": "24.18.x" },
  "scripts": {
    "clean": "tsc -b --clean && rm -rf coverage",
    "build": "tsc -b",
    "lint": "eslint .",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "vitest run",
    "check": "pnpm build && pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.13.3",
    "eslint": "10.7.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.65.0",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 3: Declare workspaces**

```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 4: Create strict shared TypeScript configuration**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": false,
    "types": ["node"]
  }
}
```

- [ ] **Step 5: Create root build references**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/contracts/tsconfig.build.json" },
    { "path": "./packages/domain/tsconfig.build.json" },
    { "path": "./packages/database/tsconfig.build.json" }
  ]
}
```

- [ ] **Step 6: Configure semantic linting**

`eslint.config.mjs`:

```js
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
```

Do not add Prettier or formatting-only rules.

- [ ] **Step 7: Configure test collection**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"],
    exclude: ["**/dist/**"],
    passWithNoTests: false,
  },
});
```

- [ ] **Step 8: Create package manifests**

Each manifest has its own package name and this export/script shape:

```json
{
  "name": "@opspulse/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src"
  }
}
```

Domain adds `"@opspulse/contracts": "workspace:*"`. Database adds both `"@opspulse/contracts": "workspace:*"` and `"@opspulse/domain": "workspace:*"`.

- [ ] **Step 9: Create package typecheck configs**

Every package `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "composite": false },
  "include": ["src/**/*.ts"]
}
```

This includes tests, allowing type-aware ESLint and TypeScript to validate them.

- [ ] **Step 10: Create package build configs**

Every `tsconfig.build.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

Contracts has no references. Domain adds a reference to `../contracts/tsconfig.build.json`. Database references contracts and domain build configs. The root build emits declarations before package typechecks resolve workspace imports.

- [ ] **Step 11: Add contracts boundary code and test**

`packages/contracts/src/index.ts`:

```ts
export type MonitorKind = "http" | "heartbeat";
```

`packages/contracts/src/index.test.ts`:

```ts
import { expect, it } from "vitest";
import type { MonitorKind } from "./index.js";

it("exports the monitor kind boundary", () => {
  const kind: MonitorKind = "http";
  expect(kind).toBe("http");
});
```

- [ ] **Step 12: Add domain boundary code and tests**

```ts
import type { MonitorKind } from "@opspulse/contracts";

export const isMonitorKind = (value: string): value is MonitorKind =>
  value === "http" || value === "heartbeat";
```

`packages/domain/src/index.test.ts`:

```ts
import { expect, it } from "vitest";
import { isMonitorKind } from "./index.js";

it.each<[string, boolean]>([
  ["http", true],
  ["heartbeat", true],
  ["smtp", false],
])("classifies %s", (value, expected) => {
  expect(isMonitorKind(value)).toBe(expected);
});
```

- [ ] **Step 13: Add database boundary code and test**

```ts
import type { MonitorKind } from "@opspulse/contracts";
import { isMonitorKind } from "@opspulse/domain";

export type StoredMonitor = { id: string; kind: MonitorKind };

export const isStoredMonitor = (value: unknown): value is StoredMonitor => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; kind?: unknown };
  return typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    isMonitorKind(candidate.kind);
};
```

`packages/database/src/index.test.ts`:

```ts
import { expect, it } from "vitest";
import { isStoredMonitor } from "./index.js";

it("validates stored monitors through package boundaries", () => {
  expect(isStoredMonitor({ id: "m1", kind: "http" })).toBe(true);
  expect(isStoredMonitor({ id: "m2", kind: "smtp" })).toBe(false);
});
```

Expected total: 3 files and 5 tests.

- [ ] **Step 14: Add repository hygiene**

`.gitignore` contains entries for `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `.idea/`, and `.vscode/`.

`.env.example` contains:

```dotenv
DATABASE_URL=postgresql://opspulse:opspulse@localhost:5432/opspulse
```

- [ ] **Step 15: Add truthful project documentation**

README sections are `OpsPulse`, `Status`, `Planned Product`, `Prerequisites`, `Design Documents`, and `License`. Status says only the workspace foundation is being implemented. Prerequisites pin Node 24.18.0 and pnpm 10.30.3. Design Documents links the spec, delivery roadmap, foundation roadmap, and this plan.

- [ ] **Step 16: Activate exact tool versions and install**

Use the installed Node version manager to activate `.nvmrc`, then run:

```bash
node --version
pnpm --version
pnpm install
```

Expected: `v24.18.0`, `10.30.3`, exit 0, no engine warning, and a new `pnpm-lock.yaml`.

- [ ] **Step 17: Build the project references**

Run: `pnpm build`

Expected: exit 0 and produce ESM JavaScript, maps, declarations, and declaration maps in each package `dist` directory.

- [ ] **Step 18: Run package tests**

Run: `pnpm test`

Expected: 3 files and 5 tests pass.

- [ ] **Step 19: Verify semantic checks**

Run: `pnpm check`

Expected: project build runs first, then lint, package source-and-test typechecks, and 5 tests exit 0.

- [ ] **Step 20: Verify clean and frozen rebuilds**

Run:

```bash
pnpm clean
pnpm install --frozen-lockfile
pnpm check
```

Expected: generated output is recreated, lockfile is reported current, and all checks pass.

- [ ] **Step 21: Commit**

```bash
git add .nvmrc .npmrc .gitignore .env.example README.md package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json eslint.config.mjs vitest.config.ts packages
git commit -m "chore: scaffold OpsPulse workspace"
```
