tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "on-error": "var(--on-error)", "error": "var(--error)", "error-container": "var(--error-container)", "on-error-container": "var(--on-error-container)",
        "primary": "var(--primary)", "on-primary": "var(--on-primary)", "primary-container": "var(--primary-container)", "on-primary-container": "var(--on-primary-container)",
        "secondary": "var(--secondary)", "on-secondary": "var(--on-secondary)", "secondary-container": "var(--secondary-container)", "on-secondary-container": "var(--on-secondary-container)",
        "tertiary": "var(--tertiary)", "on-tertiary": "var(--on-tertiary)", "tertiary-container": "var(--tertiary-container)", "on-tertiary-container": "var(--on-tertiary-container)",
        "surface": "var(--surface)", "surface-dim": "var(--surface-dim)", "surface-bright": "var(--surface-bright)",
        "surface-container-lowest": "var(--surface-container-lowest)", "surface-container-low": "var(--surface-container-low)",
        "surface-container": "var(--surface-container)", "surface-container-high": "var(--surface-container-high)", "surface-container-highest": "var(--surface-container-highest)",
        "surface-variant": "var(--surface-variant)", "on-surface": "var(--on-surface)", "on-surface-variant": "var(--on-surface-variant)",
        "outline": "var(--outline)", "outline-variant": "var(--outline-variant)",
        "background": "var(--background)", "on-background": "var(--on-background)",
        "inverse-surface": "var(--inverse-surface)", "inverse-on-surface": "var(--inverse-on-surface)", "inverse-primary": "var(--inverse-primary)",
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
