import Link from "next/link";
import { Glyph } from "./glyphs";
import type { NextgenFeature } from "@/lib/nextgen/features";

interface Props {
  feature: NextgenFeature;
}

/**
 * ConstellationTile — one of 13 next-gen feature cards in the
 * constellation strip. Pure visual: 240×280 frame, preview tile
 * with a glyph on top, name + tagline + arrow below. Hover lifts
 * the tile 4px and fades in the arrow.
 *
 * The glyph is rendered at 64px inside a 130px preview tile,
 * centered. The preview background is `verticalCardBackground(gold)`
 * so the constellation tile reads as part of the homepage even
 * though the brand color is gold rather than a per-vertical accent.
 */
export function ConstellationTile({ feature }: Props) {
  // All 13 features share the brand gold accent; mixing toward ink
  // produces the same dark warm surface as the rest of the homepage.
  // (verticalCardBackground() lives in @/lib/homepage/fanCovers.ts.)
  const previewBg = mixGoldSurface();

  return (
    <Link href={feature.route} className="home-constellation-tile" aria-label={`${feature.name} — ${feature.tagline}`}>
      <div className="home-constellation-preview" style={{ background: previewBg }}>
        <Glyph id={feature.glyphId} size={64} />
      </div>
      <div className="home-constellation-body">
        <h3 className="home-constellation-name">{feature.name}</h3>
        <p className="home-constellation-tagline">{feature.tagline}</p>
      </div>
      <span className="home-constellation-arrow" aria-hidden>
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

/**
 * Mix the brand gold #C9A03C 12% toward ink #070B12 to produce a dark
 * warm preview surface. Inline (no extra import) — kept here so this
 * component stays self-contained.
 */
function mixGoldSurface(): string {
  const gold = { r: 0xc9, g: 0xa0, b: 0x3c };
  const ink = { r: 0x07, g: 0x0b, b: 0x12 };
  const mix = (a: number, i: number) => Math.round(a * 0.12 + i * 0.88);
  return `rgb(${mix(gold.r, ink.r)}, ${mix(gold.g, ink.g)}, ${mix(gold.b, ink.b)})`;
}
