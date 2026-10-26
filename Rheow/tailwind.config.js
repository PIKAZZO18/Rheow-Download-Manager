/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#ffffff",
        paper: "#f5f5f5",
        ash: "#e5e5e5",
        smoke: "#d4d4d4",
        pebble: "#c8c8c8",
        midnight: "#0a0a0a",
        charcoal: "#171717",
        graphite: "#262626",
        slate: "#404040",
        steel: "#525252",
        fog: "#737373",
        silver: "#a3a3a3",
        "electric-blue": "#2563eb",
        "deep-sapphire": "#1e40af",
        "soft-mint": "#dcfce7",
        "vivid-green": "#16a34a",
        tangerine: "#ea580c",
        "tangerine-light": "#ffedd5",
        lavender: "#7c3aed",
        "lavender-light": "#ede9fe",
        "blue-light": "#dbeafe",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["Geist Mono", "JetBrains Mono", "Consolas", "monospace"],
      },
      borderRadius: {
        pill: "9999px",
        card: "12px",
        btn: "8px",
        input: "6px",
      },
    },
  },
  plugins: [],
}
