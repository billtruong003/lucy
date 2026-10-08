/** @type {import('tailwindcss').Config} */
// Màu TRỎ VÀO CSS var ở index.css (NGUỒN DUY NHẤT — hết fork inkfaint/line).
// Alpha modifier (bg-cyan/10) chạy nhờ format rgb(var(--x-ch) / <alpha-value>).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* ── semantic (khuyến khích dùng) ── */
        canvas: "var(--surface-canvas)",
        surface1: "var(--surface-1)",
        surface2: "var(--surface-2)",
        surface3: "var(--surface-3)",
        surface4: "var(--surface-4)",
        accent: "rgb(var(--cyan-ch) / <alpha-value>)",
        value: "rgb(var(--gold-ch) / <alpha-value>)",
        success: "rgb(var(--grn-ch) / <alpha-value>)",
        warning: "rgb(var(--amber-ch) / <alpha-value>)",
        danger: "rgb(var(--rose-ch) / <alpha-value>)",
        txt: "rgb(var(--ink-ch) / <alpha-value>)",
        txt2: "rgb(var(--ink2-ch) / <alpha-value>)",
        txt3: "rgb(var(--ink3-ch) / <alpha-value>)",
        border: "var(--border-default)",
        "border-subtle": "var(--border-subtle)",
        "border-strong": "var(--border-strong)",
        viz1: "var(--viz-1)", viz2: "var(--viz-2)", viz3: "var(--viz-3)", viz4: "var(--viz-4)",
        viz5: "var(--viz-5)", viz6: "var(--viz-6)", viz7: "var(--viz-7)", viz8: "var(--viz-8)",
        /* ── legacy names → CÙNG token (giữ class cũ chạy) ── */
        bg: "var(--surface-canvas)",
        panel: "var(--surface-1)",
        panel2: "var(--surface-2)",
        line: "var(--border-default)",
        cyan: "rgb(var(--cyan-ch) / <alpha-value>)",
        teal: "rgb(var(--teal-ch) / <alpha-value>)",
        grn: "rgb(var(--grn-ch) / <alpha-value>)",
        lime: "rgb(var(--grn-ch) / <alpha-value>)",   /* FIX: lime chưa từng khai → tab AutoTask mất màu; map về success */
        pink: "#ff5d9e",
        gold: "rgb(var(--gold-ch) / <alpha-value>)",
        rose: "rgb(var(--rose-ch) / <alpha-value>)",
        violet: "rgb(var(--violet-ch) / <alpha-value>)",
        ink: "rgb(var(--ink-ch) / <alpha-value>)",
        inkdim: "rgb(var(--ink2-ch) / <alpha-value>)",
        inkfaint: "rgb(var(--ink3-ch) / <alpha-value>)",
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', "ui-monospace", "monospace"],
        num: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        sans: ['Inter', "system-ui", "sans-serif"],
        display: ['"Space Grotesk"', "sans-serif"],
      },
      borderRadius: {
        card: "var(--radius-md)",   /* 12px — 1 card */
        panel: "var(--radius-lg)",  /* 16px */
        pill: "999px",
      },
      boxShadow: {
        glow: "var(--glow-accent)",
        "glow-gold": "var(--glow-value)",
        "elev-sm": "var(--shadow-sm)",
        "elev-md": "var(--shadow-md)",
        "elev-lg": "var(--shadow-lg)",
        card: "var(--shadow-sm)",
      },
    },
  },
  plugins: [],
}
