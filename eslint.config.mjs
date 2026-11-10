import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "coverage/**",
    "build/**",
    "next-env.d.ts",
    // Executor worktrees are full checkouts of another branch
    ".claude/worktrees/**",
    // Output of npm run visual, including its copy of the static build
    "visual-output/**",
    "visual-baseline/**",
  ]),
]);

export default eslintConfig;
