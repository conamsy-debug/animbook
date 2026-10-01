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
  // Locale routing is handled entirely by apps/web/src/middleware.ts.
  // We previously declared `i18n: { locales, defaultLocale,
  // localeDetection: false }` here so Next.js would expose router.locale
  // and locale-aware helpers, but Next.js's Pages Router also runs an
  // internal locale rewrite for any `i18n.locales` URL — it normalises
  // `/fr` to `/` BEFORE middleware executes, which (combined with our
  // middleware trying to redirect bare `/` back to `/fr`) produced
  // ERR_TOO_MANY_REDIRECTS at the edge. Removing the built-in i18n
  // config makes the middleware the single source of truth.
  // Trade-off: pages no longer get a built-in `locale` property on
  // the router (we read `useRouter().locale` from the URL prefix in
  // helpers that need it).
  // We do need i18n.locales to get the `defaultLocale` rewriting out
  // of Next.js's hands, so we serve the same page content regardless
  // of locale prefix. Rewrites /<locale>/<path*> to /<path*> so
  // /fr/library and /library render the same file. Next.js evaluates
  // these AFTER middleware (so the cookie is already set and the
  // request reaches us under its original /fr/library URL).
  async rewrites() {
    return [
      {
        source: "/fr/:path*",
        destination: "/:path*"
      },
      {
        source: "/fr",
        destination: "/"
      },
      {
        source: "/es/:path*",
        destination: "/:path*"
      },
      {
        source: "/es",
        destination: "/"
      }
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;