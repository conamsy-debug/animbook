import Head from "next/head";
import type { ReactNode } from "react";
import { Topbar } from "./Topbar";

interface LegalPageProps {
  title: string;
  intro?: ReactNode;
  lastUpdated?: string;
  children: ReactNode;
}

/**
 * Reusable wrapper for legal + pricing pages.
 * Renders the Topbar, a centered prose column, and a "Last updated" footer.
 */
export function LegalPage({ title, intro, lastUpdated, children }: LegalPageProps) {
  return (
    <>
      <Head>
        <title>{`${title} · AnimBook`}</title>
        <meta name="robots" content="noindex,follow" />
      </Head>
      <div className="app-shell">
        <Topbar />
        <main className="container legal-page">
          <header className="legal-header">
            <h1>{title}</h1>
            {intro ? <p className="muted" style={{ maxWidth: 720 }}>{intro}</p> : null}
          </header>
          <div className="legal-body">{children}</div>
          {lastUpdated ? (
            <footer className="legal-footer muted">
              <small>Last updated · {lastUpdated}</small>
            </footer>
          ) : null}
        </main>
      </div>
    </>
  );
}

interface SectionProps {
  id?: string;
  title: string;
  children: ReactNode;
}

export function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
