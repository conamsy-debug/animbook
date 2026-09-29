import { Html, Head, Main, NextScript } from "next/document";

/**
 * The Pages Router document. AnimBook used to rely solely on
 * client-side effects to set `<html dir>` for RTL languages
 * (Arabic), but crawlers and progressive enhancement need it
 * server-rendered too. Next.js exposes the active locale via
 * `__NEXT_DATA__.locale` — we read that here and stamp `dir`
 * on `<html>` directly. Client-side `useApplyLocaleDocument`
 * in `_app.tsx` still updates it on navigation so a runtime
 * locale switch is reflected immediately.
 */
export default function Document() {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}