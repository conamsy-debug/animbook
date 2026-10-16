// The canonical probe now lives at probe-minimax-video.ts. This .mjs is
// kept as a forward-pointer so `npm run clips:probe` style invocations in
// older automation continue to find a file at the legacy path.
//
//   tsx scripts/probe-minimax-video.ts   # canonical
//
// When the migration smoke run is fully signed off this stub can be deleted.
throw new Error("probe-minimax-video.mjs is deprecated — use scripts/probe-minimax-video.ts");
