import { Html, Head, Main, NextScript } from "next/document";
import type { DocumentContext, DocumentInitialProps } from "next/document";

/**
 * Per-request `<html dir>` + `<html lang>`. AnimBook's built-in
 * i18n routing knows the active locale per request — we read it
 * via `ctx.locale` (set by Next.js's i18n config) and stamp the
 * right direction on `<Html>` so crawlers + screen readers see
 * it on the very first byte, with no client-side hydration
 * required.
 */
const RTL_LOCALES = new Set(["ar"]);
const ALLOWED = new Set(["ar", "fr", "es", "pt-BR", "sw", "hi", "zh-CN", "de", "en"]);

interface Props extends DocumentInitialProps {
  htmlLang: string;
  htmlDir: "ltr" | "rtl";
}

export default function Document({ htmlLang, htmlDir }: Props) {
  return (
    <Html lang={htmlLang} dir={htmlDir}>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

Document.getInitialProps = async (ctx: DocumentContext): Promise<Props> => {
  const initialProps = await ctx.defaultGetInitialProps(ctx);
  const rawLocale =
    (ctx as DocumentContext & { locale?: string }).locale || "en";
  const safeLocale = ALLOWED.has(rawLocale) ? rawLocale : "en";
  const dir: "ltr" | "rtl" = RTL_LOCALES.has(safeLocale) ? "rtl" : "ltr";
  return {
    ...initialProps,
    htmlLang: safeLocale,
    htmlDir: dir
  };
};