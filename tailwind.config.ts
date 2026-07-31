// Tailwind v4 configuration. In v4 the canonical config lives in
// globals.css via `@theme` directives — this JS file is kept only for
// tools that still read tailwind.config.ts (some IDE plugins, the legacy
// `tailwind` CLI). The previous version imported `tailwindcss-animate`
// (a Tailwind v3 plugin) which is not installed and not used by v4 —
// the v4-compatible `tw-animate-css` is imported in globals.css instead.
//
// Removing the dead import fixes the "Module not found: Can't resolve
// 'tailwindcss-animate'" Turbopack warning that appeared on every compile.
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
