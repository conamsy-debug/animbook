// Inline SVG icons used by the library redesign. The brief gives exact
// 24×24 paths in Appendix B — kept verbatim so the icons match the
// approved mockup. Stroked icons share `stroke="currentColor"`,
// `strokeWidth="1.8"`, round caps and joins; Play is filled.

import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "viewBox" | "fill" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin">;

function stroked(d: string) {
  return (props: IconProps) => (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d={d} />
    </svg>
  );
}

export const PlayIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden focusable="false" fill="currentColor" {...props}>
    <path d="M7 4.6v14.8a.6.6 0 0 0 .9.5l12-7.4a.6.6 0 0 0 0-1L7.9 4.1a.6.6 0 0 0-.9.5z" />
  </svg>
);

export const ReadIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 6.5C10.6 5.2 8.6 4.5 6 4.5H3.5v14H6c2.6 0 4.6.7 6 2 1.4-1.3 3.4-2 6-2h2.5v-14H18c-2.6 0-4.6.7-6 2z" />
    <path d="M12 6.5v14" />
  </svg>
);

export const ListenIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 17v-5a8 8 0 0 1 16 0v5" />
    <rect x="3" y="14" width="4" height="7" rx="1.6" />
    <rect x="17" y="14" width="4" height="7" rx="1.6" />
  </svg>
);

export const DetailsIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r=".7" fill="currentColor" />
  </svg>
);

export const ChevronRightIcon = stroked("M9 5l7 7-7 7");
export const ChevronLeftIcon = stroked("M15 5l-7 7 7 7");

export const SearchIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
);

export const MenuIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
