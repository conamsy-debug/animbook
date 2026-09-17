import { useId } from "react";

/** The AnimBook mark: an open book with a play button in the gutter. */
export function LogoMark({ size = 28, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="logo-mark"
    >
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F0CF6A" />
          <stop offset="1" stopColor="#B8841A" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F6DC86" />
          <stop offset="1" stopColor="#C49A1C" />
        </linearGradient>
      </defs>
      <path d="M30.5 15.5C23.5 10.8 13.8 10.6 5.5 13.6V50.6C13.8 47.6 23.5 47.8 30.5 52.5Z" fill={`url(#${id}a)`} />
      <path d="M33.5 15.5C40.5 10.8 50.2 10.6 58.5 13.6V50.6C50.2 47.6 40.5 47.8 33.5 52.5Z" fill={`url(#${id}b)`} />
      <path d="M25.5 23.2 43.2 32.6 25.5 42Z" fill="#0B111A" stroke="#0B111A" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}
