// The window's accent for the kit's primary.

/** The kit's primary (solid buttons, ticked boxes, progress) in the window's
 * accent, as Git has it, not the theme's ink. */
export const ACCENT = {
  '--primary': 'var(--node-accent)',
  '--primary-foreground': '#fff',
  '--primary-hover': 'color-mix(in srgb, var(--node-accent) 88%, #fff)',
} as React.CSSProperties;
