import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { Topbar } from "@/components/Topbar";
import { LoadingState, EmptyState } from "@/components/States";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";

interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: "public" | "user" | "verified" | "service";
  summary: string;
  notes?: string;
}

interface Module {
  id: string;
  title: string;
  description: string;
  routes: Route[];
}

interface DocsResponse {
  service: string;
  version: string;
  totalRoutes: number;
  moduleCount: number;
  modules: Module[];
}

const METHOD_COLOR: Record<string, string> = {
  GET: "#1A6B3C",
  POST: "#3F8172",
  PUT: "#B58B27",
  PATCH: "#7A6650",
  DELETE: "#C94B32"
};

const AUTH_COLOR: Record<string, string> = {
  public: "#1B6B8A",
  user: "#9D4C73",
  verified: "#D9872A",
  service: "#6B2D8B"
};

export default function DocsPage() {
  const [data, setData] = useState<DocsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("ALL");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/docs");
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        const json = (await r.json()) as DocsResponse;
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredModules = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    return data.modules
      .map((m) => {
        const routes = m.routes.filter((r) => {
          if (methodFilter !== "ALL" && r.method !== methodFilter) return false;
          if (!q) return true;
          return (
            r.path.toLowerCase().includes(q) ||
            r.summary.toLowerCase().includes(q) ||
            r.notes?.toLowerCase().includes(q) ||
            m.title.toLowerCase().includes(q)
          );
        });
        return { ...m, routes };
      })
      .filter((m) => m.routes.length > 0);
  }, [data, filter, methodFilter]);

  if (loading) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container"><LoadingState message="Loading the API catalogue…" /></main>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <EmptyState
            title="API catalogue is offline"
            message={error ?? "Couldn't reach the AnimBook API."}
            cta={{ href: "/api/docs", label: "Open JSON directly" }}
          />
        </main>
      </div>
    );
  }

  const methods = Array.from(new Set(data.modules.flatMap((m) => m.routes.map((r) => r.method))));

  return (
    <>
      <Head>
        <title>API docs · AnimBook</title>
        <meta name="description" content="AnimBook public API catalogue — every route, every auth gate." />
      </Head>
      <div className="app-shell">
        <Topbar />
        <ErrorBoundary
          fallback={(err, reset) => (
            <main className="container">
              <ErrorState error={err} onRetry={reset} title="The docs page failed to render" />
            </main>
          )}
        >
        <main className="container docs-page">
          <header className="legal-header">
            <h1>AnimBook API</h1>
            <p className="muted" style={{ maxWidth: 720 }}>
              The full route catalogue for {data.moduleCount} modules and {data.totalRoutes} endpoints.
              Filter by HTTP method, search by path or summary, copy any endpoint into your integration.
            </p>
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              Schema version {data.version}.
              {" "}<a href="/api/docs" target="_blank" rel="noreferrer">Raw JSON →</a>
            </p>
          </header>

          <div className="docs-toolbar">
            <input
              type="search"
              placeholder="Filter by path or summary…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="docs-search"
            />
            <div className="docs-method-filter">
              <button
                onClick={() => setMethodFilter("ALL")}
                className={methodFilter === "ALL" ? "on" : ""}
                type="button"
              >
                All
              </button>
              {methods.map((m) => (
                <button
                  key={m}
                  onClick={() => setMethodFilter(m)}
                  className={methodFilter === m ? "on" : ""}
                  type="button"
                  style={methodFilter === m ? { background: METHOD_COLOR[m], color: "#0D1B2E" } : undefined}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="docs-modules">
            {filteredModules.map((m) => (
              <section key={m.id} className="docs-module">
                <header>
                  <h2>{m.title}</h2>
                  <p className="muted">{m.description}</p>
                </header>
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Method</th>
                      <th>Path</th>
                      <th style={{ width: 80 }}>Auth</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.routes.map((r) => (
                      <tr key={`${r.method}:${r.path}`}>
                        <td>
                          <span
                            className="method-tag"
                            style={{ background: METHOD_COLOR[r.method], color: "#0D1B2E" }}
                          >
                            {r.method}
                          </span>
                        </td>
                        <td className="docs-path">
                          <code>{r.path}</code>
                        </td>
                        <td>
                          <span
                            className="auth-tag"
                            style={{ borderColor: AUTH_COLOR[r.auth], color: AUTH_COLOR[r.auth] }}
                            title={r.auth === "public" ? "No auth header required" : r.auth === "user" ? "Clerk session required" : r.auth === "verified" ? "Email-verified session" : "Service-to-service only"}
                          >
                            {r.auth}
                          </span>
                        </td>
                        <td>
                          <div className="docs-summary">{r.summary}</div>
                          {r.notes ? <div className="docs-notes">{r.notes}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            {filteredModules.length === 0 ? (
              <EmptyState
                title="No routes match"
                message={`No route matched ${filter ? `"${filter}"` : "the current filter"}.`}
                cta={{ href: "/docs", label: "Clear filter" }}
              />
            ) : null}
          </div>
        </main>
        </ErrorBoundary>
      </div>
    </>
  );
}
