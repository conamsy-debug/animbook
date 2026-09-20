import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface ApiKeyListItem {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitRpm: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface WhoAmIResponse {
  key: { id: string; prefix: string; scopes: string[]; rateLimitRpm: number };
}

const SCOPE_DOCS: { scope: string; label: string; description: string }[] = [
  { scope: "books:read", label: "Read books", description: "GET /api/books, GET /api/books/:id, GET /api/books/:id/pages — list and read published AnimBooks." },
  { scope: "library:write", label: "Modify library", description: "POST /api/library — record the reader's progress on behalf of a signed-in user." },
  { scope: "edu:write", label: "Post EDU work", description: "POST /api/edu/* — push curriculum data on behalf of a teacher account." },
  { scope: "creator:read", label: "Read creator profile", description: "GET /api/creator/:handle — read public creator profiles and book metadata." }
];

export default function NetworkPage() {
  const [keys, setKeys] = useState<ApiKeyListItem[] | null>(null);
  const [newKeyName, setNewKeyName] = useState("Integration");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["books:read"]);
  const [issued, setIssued] = useState<{ prefix: string; secret: string; scopes: string[] } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; body: string; status: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ items: ApiKeyListItem[] }>("/api/network/keys");
        if (!cancelled) setKeys(res.items);
      } catch (err) {
        if (!cancelled) toast(`Could not load keys: ${(err as Error).message}`);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function issueKey() {
    try {
      const res = await apiFetch<{ id: string; prefix: string; secret: string; scopes: string[]; warning: string }>("/api/network/keys", {
        method: "POST",
        json: { name: newKeyName, scopes: newKeyScopes, rateLimitRpm: 60 }
      });
      setIssued({ prefix: res.prefix, secret: res.secret, scopes: res.scopes });
      setTestResult(null);
      const refreshed = await apiFetch<{ items: ApiKeyListItem[] }>("/api/network/keys");
      setKeys(refreshed.items);
      toast("API key issued — copy the secret now");
    } catch (err) {
      toast(`Could not issue key: ${(err as Error).message}`);
    }
  }

  /** Hit /api/whoami with the freshly-issued key as Bearer, so the user
   *  can verify their copy is correct before integrating. Direct fetch
   *  (not apiFetch) — we need to send the new key, not the Clerk token. */
  async function testKey() {
    if (!issued) return;
    setTesting(true);
    setTestResult(null);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const token = `${issued.prefix}.${issued.secret}`;
      const res = await fetch(`${base}/api/whoami`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await res.text();
      setTestResult({ ok: res.ok, status: res.status, body });
    } catch (err) {
      setTestResult({ ok: false, status: 0, body: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function revoke(id: string) {
    try {
      await apiFetch(`/api/network/keys/${id}/revoke`, { method: "POST" });
      const refreshed = await apiFetch<{ items: ApiKeyListItem[] }>("/api/network/keys");
      setKeys(refreshed.items);
      toast("API key revoked");
    } catch (err) {
      toast(`Revoke failed: ${(err as Error).message}`);
    }
  }

  function toggleScope(scope: string) {
    setNewKeyScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#0A7B8A" }} />
            <h1>AnimBook NETWORK</h1>
          </div>
          <span className="label">Public API for partner integrations</span>
        </header>

        <section className="card">
          <h3>Issue a new API key</h3>
          <p className="muted">A key is presented as <code>prefix.secret</code> via <code>Authorization: Bearer &lt;token&gt;</code>. The secret is shown once.</p>
          <label>
            <span className="label">Name</span>
            <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
          </label>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {["books:read", "library:write", "edu:write", "creator:read"].map((scope) => (
              <label key={scope} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={newKeyScopes.includes(scope)} onChange={() => toggleScope(scope)} style={{ width: 18, height: 18 }} />
                <span>{scope}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn primary" onClick={issueKey} style={{ marginTop: 12 }} disabled={!newKeyName || newKeyScopes.length === 0}>
            Issue key
          </button>
        </section>

        {issued && (
          <section className="card" style={{ marginTop: 16, borderColor: "#C49A1C" }}>
            <h3>Save this secret now</h3>
            <p className="muted">It will not be shown again.</p>
            <p style={{ fontFamily: "var(--mono)", padding: 12, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", overflowX: "auto" }}>
              {issued.prefix}.{issued.secret}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(`${issued.prefix}.${issued.secret}`)}>
                Copy to clipboard
              </button>
              <button type="button" className="btn primary" onClick={testKey} disabled={testing}>
                {testing ? "Testing…" : "Test this key"}
              </button>
            </div>
            {testResult && (
              <div style={{ marginTop: 12 }}>
                <p style={{ color: testResult.ok ? "var(--wellness)" : "var(--comics)" }}>
                  {testResult.ok ? `✓ ${testResult.status}` : `✗ ${testResult.status}`}
                </p>
                <pre style={{ fontFamily: "var(--mono)", padding: 10, background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)", overflowX: "auto", margin: 0, fontSize: ".75rem" }}>
                  {testResult.body}
                </pre>
              </div>
            )}
          </section>
        )}

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#14818E" }} />
              <h2>Active keys</h2>
            </div>
            <span className="label">{keys?.length ?? 0} keys</span>
          </header>
          {keys && keys.length === 0 ? (
            <div className="empty-state">No keys yet. Issue one to integrate with the AnimBook API.</div>
          ) : (
            keys && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Prefix</Th>
                    <Th>Scopes</Th>
                    <Th>Rate</Th>
                    <Th>Last used</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <Td><strong>{key.name}</strong></Td>
                      <Td><code>{key.prefix}</code></Td>
                      <Td>{key.scopes.join(", ")}</Td>
                      <Td>{key.rateLimitRpm} rpm</Td>
                      <Td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "—"}</Td>
                      <Td>
                        <button type="button" className="btn ghost" onClick={() => revoke(key.id)}>Revoke</button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#56738A" }} />
              <h2>Scopes</h2>
            </div>
          </header>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>Scope</Th>
                <Th>Label</Th>
                <Th>What it unlocks</Th>
              </tr>
            </thead>
            <tbody>
              {SCOPE_DOCS.map((s) => (
                <tr key={s.scope} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td><code>{s.scope}</code></Td>
                  <Td>{s.label}</Td>
                  <Td><span className="muted">{s.description}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={{ marginTop: 24 }}>
          <header className="section-header">
            <div className="left">
              <span className="dot" style={{ background: "#C49A1C" }} />
              <h2>Echo endpoint</h2>
            </div>
          </header>
          <p className="muted">Hit <code>GET /api/whoami</code> with your bearer key to confirm the server can resolve it. Returns the key's id, prefix, scopes, and rate-limit.</p>
          <pre style={{ fontFamily: "var(--mono)", padding: 12, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)", overflowX: "auto", margin: 0, fontSize: ".75rem" }}>
{`curl -H "Authorization: Bearer $TOKEN" \\
     https://api.animbook.com/api/whoami
# → { "key": { "id": "...", "prefix": "abk_xxxx", "scopes": ["books:read"], "rateLimitRpm": 60 } }`}
          </pre>
        </section>
      </main>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "8px 12px", fontFamily: "var(--mono)", fontSize: ".7rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--text-muted)" }}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={className} style={{ padding: "8px 12px", verticalAlign: "top" }}>{children}</td>;
}