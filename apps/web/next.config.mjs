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
  transpilePackages: ["@animbook/domain"],
  // Standalone output is required for the production Docker image.
  // `next build` will emit a self-contained server in .next/standalone.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;