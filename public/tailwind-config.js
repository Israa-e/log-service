tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-error": "#690005", "error": "#ffb4ab", "error-container": "#93000a", "on-error-container": "#ffdad6",
        "primary": "#adc6ff", "on-primary": "#002e6a", "primary-container": "#4d8eff", "on-primary-container": "#00285d",
        "secondary": "#c0c1ff", "on-secondary": "#1000a9", "secondary-container": "#3131c0", "on-secondary-container": "#b0b2ff",
        "tertiary": "#4edea3", "on-tertiary": "#003824", "tertiary-container": "#00a572", "on-tertiary-container": "#00311f",
        "surface": "#051424", "surface-dim": "#051424", "surface-bright": "#2c3a4c",
        "surface-container-lowest": "#010f1f", "surface-container-low": "#0d1c2d",
        "surface-container": "#122131", "surface-container-high": "#1c2b3c", "surface-container-highest": "#273647",
        "surface-variant": "#273647", "on-surface": "#d4e4fa", "on-surface-variant": "#c2c6d6",
        "outline": "#8c909f", "outline-variant": "#424754",
        "background": "#051424", "on-background": "#d4e4fa",
        "inverse-surface": "#d4e4fa", "inverse-on-surface": "#233143", "inverse-primary": "#005ac2",
        "orange-400": "#f59e0b"
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
        gutter: "16px",
        margin: "24px"
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px"
      },
      fontFamily: {
        "body-lg": ["Inter"],
        display: ["Inter"],
        h1: ["Inter"],
        "body-md": ["Inter"],
        h3: ["Inter"],
        "body-sm": ["Inter"],
        "code-md": ["JetBrains Mono"],
        "label-caps": ["Inter"],
        h2: ["Inter"],
        "code-sm": ["JetBrains Mono"]
      },
      fontSize: {
        "body-lg": ["18px", { lineHeight: "28px", fontWeight: "400" }],
        display: ["36px", { lineHeight: "44px", letterSpacing: "-0.02em", fontWeight: "700" }],
        h1: ["30px", { lineHeight: "38px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-md": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        h3: ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-sm": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "code-md": ["14px", { lineHeight: "20px", fontWeight: "450" }],
        "label-caps": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
        h2: ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "code-sm": ["12px", { lineHeight: "18px", fontWeight: "450" }]
      }
    }
  }
}
