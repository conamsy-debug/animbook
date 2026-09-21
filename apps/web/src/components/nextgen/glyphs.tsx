/**
 * Inline SVG glyphs for the 13 next-gen feature tiles.
 *
 * Each glyph is a 24x24 viewBox SVG. The component renders it at 64px
 * inside a 130px preview tile, centered. Paths are deliberately simple
 * — geometric primitives that hint at the concept, not detailed
 * illustrations. The brief's glyph table is the source of truth.
 *
 * All glyphs use `currentColor` so the constellation tile's accent
 * color cascades through. Fill or stroke is decided per glyph (see
 * the table in docs/nextgen-features-plan.md).
 */

import type { NextgenFeature } from "@/lib/nextgen/features";

interface GlyphProps {
  id: NextgenFeature["id"];
  size?: number;
}

/** Single lookup. Throws for unknown ids. */
export function Glyph({ id, size = 64 }: GlyphProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false
  };
  switch (id) {
    case "memory":
      // brain outline (left + right hemispheres + bridge)
      return (
        <svg {...props}>
          <path d="M8 4c-3 0-5 2-5 5 0 1 .5 2 1 3-1 1-1 2-1 3 0 3 2 5 5 5 1 0 2-.5 2-1l1-1V5l-1-1c-1 0-2 0-2 0z" />
          <path d="M16 4c3 0 5 2 5 5 0 1-.5 2-1 3 1 1 1 2 1 3 0 3-2 5-5 5-1 0-2-.5-2-1l-1-1V5l1-1c1 0 2 0 2 0z" />
          <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" />
        </svg>
      );
    case "lens":
      // eye outline + pupil
      return (
        <svg {...props}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "echo":
      // three concentric arcs
      return (
        <svg {...props}>
          <path d="M5 8a8 8 0 0 1 0 8" />
          <path d="M9 6a12 12 0 0 1 0 12" />
          <path d="M13 4a16 16 0 0 1 0 16" />
        </svg>
      );
    case "live-translation":
      // two speech bubbles overlapping
      return (
        <svg {...props}>
          <path d="M3 6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H8l-3 3v-3H5a2 2 0 0 1-2-2V6z" />
          <path d="M11 12a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1l-2 2v-2a2 2 0 0 1-2-2v-3z" fill="currentColor" fillOpacity="0.18" />
        </svg>
      );
    case "live":
      // three dots in a row + radio waves
      return (
        <svg {...props}>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" />
          <path d="M19 8a6 6 0 0 1 0 8M21 6a8 8 0 0 1 0 12" />
        </svg>
      );
    case "dream":
      // crescent moon
      return (
        <svg {...props}>
          <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z" fill="currentColor" fillOpacity="0.18" />
          <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z" />
        </svg>
      );
    case "worlds":
      // connected-dots graph (5 nodes)
      return (
        <svg {...props}>
          <circle cx="6" cy="7" r="1.4" fill="currentColor" />
          <circle cx="18" cy="7" r="1.4" fill="currentColor" />
          <circle cx="6" cy="17" r="1.4" fill="currentColor" />
          <circle cx="18" cy="17" r="1.4" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <path d="M7 8l4 3M17 8l-4 3M7 16l4-3M17 16l-4-3" />
        </svg>
      );
    case "stage":
      // stage curtain (top rail + two angled drapes)
      return (
        <svg {...props}>
          <path d="M2 6h20" />
          <path d="M5 6l-2 14M19 6l2 14M8 6l-1 14M16 6l1 14M12 6v14" />
        </svg>
      );
    case "signal":
      // pulse line (heartbeat)
      return (
        <svg {...props}>
          <path d="M2 12h4l2-6 3 12 3-9 2 6 2-3h4" />
        </svg>
      );
    case "network":
      // center node + three branches
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="4" cy="5" r="1.4" fill="currentColor" />
          <circle cx="20" cy="5" r="1.4" fill="currentColor" />
          <circle cx="12" cy="20" r="1.4" fill="currentColor" />
          <path d="M11 11l-6-5M13 11l6-5M12 14v5" />
        </svg>
      );
    case "archive":
      // stack of three sheets
      return (
        <svg {...props}>
          <rect x="3" y="4" width="14" height="3" rx="1" />
          <rect x="5" y="9" width="16" height="3" rx="1" />
          <rect x="3" y="14" width="14" height="3" rx="1" />
          <rect x="5" y="19" width="16" height="3" rx="1" fill="currentColor" fillOpacity="0.18" />
        </svg>
      );
    case "school":
      // chalkboard with stand
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="12" rx="1.5" />
          <path d="M3 16l3 4M21 16l-3 4" />
          <path d="M6 9l2 2 4-4M6 12h2" />
        </svg>
      );
    case "studio-pro":
      // phone outline with a marker (QR-like dots)
      return (
        <svg {...props}>
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M10 5h4M10 19h4" />
          <rect x="9" y="8" width="2" height="2" fill="currentColor" />
          <rect x="13" y="8" width="2" height="2" fill="currentColor" />
          <rect x="9" y="12" width="2" height="2" fill="currentColor" />
          <rect x="13" y="12" width="2" height="2" fill="currentColor" />
        </svg>
      );
    default:
      // exhaustiveness check — TS will error if a new id is added
      // without a glyph case.
      const _exhaustive: never = id;
      void _exhaustive;
      return null;
  }
}
