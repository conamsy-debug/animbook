/**
 * AnimBook TV — top-level router.
 */
import { useEffect, useState } from "react";
import { TvLibrary } from "./TvApp";
import { TvReader } from "./TvReader";
import { WorldsView } from "./WorldsView";
import { DreamView } from "./DreamView";
import { CompanionView } from "./CompanionView";
import { ProfileView } from "./ProfileView";
import { api } from "./api";

type View =
  | { kind: "library" }
  | { kind: "reader"; slug: string }
  | { kind: "worlds" }
  | { kind: "dream" }
  | { kind: "companion" }
  | { kind: "profile" };

export function App() {
  const [view, setView] = useState<View>({ kind: "library" });
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const book = params.get("book");
    const marker = params.get("marker");
    const nfc = params.get("nfc");
    if (book) {
      setView({ kind: "reader", slug: book });
    } else if (marker || nfc) {
      const path = marker
        ? `/api/studio-pro/scan/marker/${encodeURIComponent(marker)}`
        : `/api/studio-pro/scan/nfc/${encodeURIComponent(nfc ?? "")}`;
      fetch(`${api.base}${path}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const slug = j?.book?.slug;
          if (typeof slug === "string") setView({ kind: "reader", slug });
        })
        .catch(() => undefined);
    }
    setBootstrapped(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Menu" || event.key === "Backspace") {
        if (view.kind !== "library") setView({ kind: "library" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.kind]);

  if (!bootstrapped) return null;

  switch (view.kind) {
    case "library":
      return (
        <TvLibrary
          onSelect={(slug) => setView({ kind: "reader", slug })}
          onJumpDream={() => setView({ kind: "dream" })}
          onJumpCompanion={() => setView({ kind: "companion" })}
          onJumpProfile={() => setView({ kind: "profile" })}
        />
      );
    case "reader":
      return <TvReader slug={view.slug} onBack={() => setView({ kind: "library" })} />;
    case "worlds":
      return <WorldsView onBack={() => setView({ kind: "library" })} />;
    case "dream":
      return <DreamView onBack={() => setView({ kind: "library" })} />;
    case "companion":
      return <CompanionView onBack={() => setView({ kind: "library" })} />;
    case "profile":
      return <ProfileView onBack={() => setView({ kind: "library" })} />;
  }
}