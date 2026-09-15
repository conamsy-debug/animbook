/**
 * AnimBook mobile — `/tv` route entry.
 *
 * Renders the Apple TV focus-driven library inside the mobile shell. On
 * native tvOS the focus engine routes focus via the hardware remote;
 * on web it's driven by the keyboard hook inside `_layout.tsx`.
 *
 * This mirrors the standalone `apps/tv` so the mobile install is a
 * single binary that knows how to be both phone and TV.
 */
import TvLayout from "./(tv)/_layout";

export default TvLayout;