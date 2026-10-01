/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./new/index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      /* Tokens for the new look (src/next, served at /new/). New names only, so nothing the old
         look uses changes: radii are tile / card / hero / pill rather than overriding 2xl-4xl. */
      colors: {
        canvas: "#ffffff",
        satin: { DEFAULT: "#f4f5f8", 2: "#eceef3" },
        line: "#e9ebf0",
        ink: { DEFAULT: "#0b0d12", 2: "#3a3f4b", 3: "#646b78", 4: "#9aa0ab" },
        nova: { DEFAULT: "#2f7bf5", fill: "#2563eb", deep: "#1d4ed8", soft: "#e8f0ff", glow: "#8fb8ff" },
        ok: { DEFAULT: "#16a34a", soft: "#e7f7ec", ink: "#15803d" },
        warn: { DEFAULT: "#f59e0b", soft: "#fff4dc", ink: "#a16207" },
        bad: { DEFAULT: "#ef4444", soft: "#feecec", ink: "#b91c1c", hover: "#fdd8d8" },
        violet: { soft: "#efeaff", ink: "#6d28d9" },
        // company hues, for charts and the small company dot only (same values as the old look)
        co: { gainup: "#0e7490", technotek: "#7c3aed", zenwear: "#be1250" },
      },
      borderRadius: { tile: "24px", card: "28px", hero: "36px", pill: "9999px" },
      boxShadow: {
        chip: "0 2px 8px rgba(23, 30, 60, 0.06)",
        card: "0 8px 24px rgba(23, 30, 60, 0.06), 0 1px 2px rgba(23, 30, 60, 0.04)",
        float: "0 16px 40px rgba(23, 30, 60, 0.10), 0 2px 6px rgba(23, 30, 60, 0.05)",
        "glow-nova": "0 12px 32px rgba(47, 123, 245, 0.28)",
      },
      fontFamily: {
        ui: ['"Geist Variable"', "-apple-system", '"SF Pro Display"', '"Helvetica Neue"', '"Segoe UI"', "sans-serif"],
        code: ['"Geist Mono Variable"', "ui-monospace", '"SF Mono"', "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
