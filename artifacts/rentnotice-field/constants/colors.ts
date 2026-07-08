/**
 * Semantic design tokens for RentNotice Field.
 * Synced from the RentNotice Pro web app (artifacts/rentnotice-pro/src/index.css)
 * — deep navy + warm gold accent, professional legal aesthetic.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: "#0f1729",
    tint: "#0f1729",

    // Core surfaces
    background: "#f7f9fa",
    foreground: "#0f1729",

    // Cards / elevated surfaces
    card: "#ffffff",
    cardForeground: "#0f1729",

    // Primary action color (buttons, links, active states)
    primary: "#0f1729",
    primaryForeground: "#f7fafc",

    // Secondary / less-emphasis interactive surfaces
    secondary: "#f1f5f9",
    secondaryForeground: "#101d33",

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: "#f1f5f9",
    mutedForeground: "#64748b",

    // Accent highlights (badges, selected items, focus rings) — warm gold
    accent: "#e8ddc9",
    accentForeground: "#0f1729",

    // Destructive actions (delete, error states)
    destructive: "#ef4444",
    destructiveForeground: "#f7fafc",

    // Success (completed assignments)
    success: "#16a34a",
    successForeground: "#ffffff",

    // Warning (pending sync / offline)
    warning: "#b45309",
    warningForeground: "#ffffff",

    // Borders and input outlines
    border: "#e2e8f0",
    input: "#e2e8f0",
  },

  dark: {
    text: "#f7fafc",
    tint: "#f7fafc",

    background: "#0f1729",
    foreground: "#f7fafc",

    card: "#16203a",
    cardForeground: "#f7fafc",

    primary: "#f7fafc",
    primaryForeground: "#101d33",

    secondary: "#1e293b",
    secondaryForeground: "#f7fafc",

    muted: "#1e293b",
    mutedForeground: "#94a3b8",

    accent: "#b38a4d",
    accentForeground: "#f7fafc",

    destructive: "#b91c1c",
    destructiveForeground: "#f7fafc",

    success: "#22c55e",
    successForeground: "#0f1729",

    warning: "#f59e0b",
    warningForeground: "#0f1729",

    border: "#1e293b",
    input: "#1e293b",
  },

  // Border radius (in px). Synced from the web app's --radius (0.5rem).
  radius: 8,
};

export default colors;
