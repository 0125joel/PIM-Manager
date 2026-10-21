import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "src"),
        },
    },
    test: {
        include: ["src/__tests__/**/*.test.ts"],
        environment: "node",
        coverage: {
            // Only `npm run test:coverage` measures; `npm test` is unaffected. A floor per file for the Configure write
            // path, review and Import utils (N-014): each file just under what it had on 2026-10-08, so a new branch
            // without a test fails the coverage run.
            thresholds: {
                "src/{utils,services}/{configure*,applyPlan,assignmentForm,assignmentRequests,import*,policyRules,settingValues,guidedRoute,writeAccess,accessModel*}.ts": {
                    perFile: true,
                    lines: 90,
                    statements: 85,
                    functions: 85,
                    branches: 65,
                },
            },
        },
    },
});
