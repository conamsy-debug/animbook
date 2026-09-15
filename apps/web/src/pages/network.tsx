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

export default function NetworkPage() {
  const [keys, setKeys] = useState<ApiKeyListItem[] | null>(null);
  const [newKeyName, setNewKeyName] = useState("Integration");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["books:read"]);
  const [issued, setIssued] = useState<{ prefix: string; secret: string; scopes: string[] } | null>(null);
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
      const refreshed = await apiFetch<{ items: ApiKeyListItem[] }>("/api/network/keys");
      setKeys(refreshed.items);
      toast("API key issued — copy the secret now");
    } catch (err) {
      toast(`Could not issue key: ${(err as Error).message}`);
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
            <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(`${issued.prefix}.${issued.secret}`)}>
              Copy to clipboard
            </button>
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
              <h2>Endpoint reference</h2>
            </div>
          </header>
          <p className="muted">All endpoints under <code>/api/*</code> accept the bearer API key. The recommended echo endpoint is <code>GET /api/whoami</code>.</p>
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

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px 12px", verticalAlign: "top" }}>{children}</td>;
}