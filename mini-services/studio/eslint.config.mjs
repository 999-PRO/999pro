import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Phase 24: Re-enabled critical ESLint rules that were previously disabled.
// These rules catch real bugs:
//   - exhaustive-deps: catches missing useEffect deps (race conditions)
//   - no-unused-vars: catches dead code
//   - no-explicit-any: catches type safety issues (downgraded to "warn")
//   - prefer-const: catches mutable variables that should be const
//   - no-empty: catches empty catch blocks that swallow errors
//
// Rules that remain OFF (too noisy for this codebase):
//   - no-img-element: we use <img> everywhere, migration to next/image is planned
//   - no-console: we use console for dev logging
//   - display-name, prop-types: not relevant for React 19 + TypeScript
const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // Downgraded to "warn" instead of "off" — flags `any` usage without
    // breaking the build. Developers see warnings in IDE.
    "@typescript-eslint/no-explicit-any": "warn",
    // Re-enabled — catches unused imports/variables (dead code).
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-non-null-assertion": "off",
    // Re-enabled — catches missing useEffect deps (race conditions, stale closures).
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "off",
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/refs": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "@next/next/no-img-element": "off",
    // Re-enabled — catches mutable variables that should be const.
    "prefer-const": "warn",
    "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
    "no-console": "off",
    // Re-enabled — catches empty catch blocks that swallow errors silently.
    "no-empty": "warn",
  },
}, {
  ignores: ["node_modules/**", ".next/**"],
}];

export default eslintConfig;
