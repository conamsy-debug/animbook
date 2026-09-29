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
  // Built-in i18n routing: every URL is locale-prefixed except English,
  // which stays at the root (`/library`, `/`, etc.). next-intl handles
  // translations only; this config owns the URL → page mapping.
  // We deliberately do NOT also wrap with `createNextIntlPlugin` here —
  // the plugin is App-Router-flavoured and warns about i18n config
  // conflicts. Pages Router uses Next.js's built-in routing directly.
  i18n: {
    locales: [
      "en",
      "fr",
      "es",
      "pt-BR",
      "sw",
      "ar",
      "hi",
      "zh-CN",
      "de"
    ],
    defaultLocale: "en",
    // We do our own Accept-Language negotiation in middleware so the
    // cookie persistence + redirect chain stays predictable.
    localeDetection: false
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;