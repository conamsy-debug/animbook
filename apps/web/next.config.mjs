/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
];

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // AnimBook doesn't use next/image. Turning the optimizer off removes the
  // /_next/image attack surface (Next 14 has unpatched advisories there).
  images: { unoptimized: true },
  transpilePackages: ["@animbook/domain"],
  // Standalone output is required for the production Docker image.
  // `next build` will emit a self-contained server in .next/standalone.
  output: "standalone",
  // Locale routing is handled entirely by apps/web/src/middleware.ts,
  // which collapses any /<locale> URL prefix back to the canonical
  // (English) path and clears the animbook_locale cookie. The language
  // switcher is hidden in Topbar.tsx while the secondary locale
  // dictionaries are still empty (en.json has 206 keys; fr/es/pt/sw/ar
  // /hi/zh/de are all `{}`). When translations ship, re-add the i18n
  // block here + show the switcher — both pieces are still in the repo.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;