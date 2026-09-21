import { useEffect, useRef, useState } from "react";
import type { PageRecord } from "@/lib/api";

interface Props {
  page: PageRecord | null;
}

/**
 * BeforeAfter — manuscript vs animated comparison.
 *
 * The user drags the handle to slide between the two layers. The handle
 * is a native `<input type="range">` so it gets mouse, touch and
 * keyboard support for free. The animated layer only starts its video
 * when the section is near the viewport.
 */
export function BeforeAfter({ page }: Props) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [position, setPosition] = useState(50);
  const [videoActive, setVideoActive] = useState(false);

  // IntersectionObserver — autoplay video only when near the viewport.
  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            video.play().catch(() => undefined);
            setVideoActive(true);
          } else {
            video.pause();
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(section);
    return () => io.disconnect();
  }, [page?.videoUrl]);

  const quote = (page?.textExcerpt ?? "").slice(0, 220);
  const hasQuote = quote.length > 0;

  return (
    <section ref={sectionRef} className="home-cmpsec" aria-labelledby="home-cmp-heading">
      <div className="home-cwrap">
        <h2 id="home-cmp-heading" className="home-ch">Your text, brought to life</h2>
        <p className="home-cp">
          Studio turns each page of your manuscript into a moving, narrated scene.
          Drag to compare a page before and after.
        </p>

        <div
          className="home-cmp"
          style={{ "--cmp": `${position}%` } as React.CSSProperties}
        >
          {/* Manuscript layer */}
          <div className="home-man" aria-hidden>
            <span className="home-mlab">Manuscript</span>
            <p className="home-mtxt">{hasQuote ? `"${quote}"` : "Sample manuscript text — Studio turns each page into a scene."}</p>
          </div>

          {/* Animated layer — clipped by the handle position */}
          <div className="home-ani" style={{ clipPath: `inset(0 0 0 ${position}%)` }} aria-hidden>
            {page?.videoUrl ? (
              <video
                ref={videoRef}
                src={page.videoUrl}
                poster={page.posterUrl ?? undefined}
                muted
                loop
                playsInline
                preload={videoActive ? "auto" : "metadata"}
              />
            ) : page?.posterUrl ? (
              <div
                className="home-ani-img"
                style={{ backgroundImage: `url(${page.posterUrl})` }}
              />
            ) : (
              <div className="home-ani-img home-ani-placeholder" />
            )}
            <div className="home-ascrim" />
            <span className="home-alab">AnimBook</span>
            <p className="home-acap">{hasQuote ? `"${quote}"` : "Sample scene text — the same page, alive."}</p>
          </div>

          {/* Drag handle — native range input covers the whole frame */}
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            className="home-slider"
            aria-label="Compare the manuscript with the animated page"
          />
          {/* Visible grip line + knob */}
          <div className="home-grip" aria-hidden style={{ left: `${position}%` }}>
            <div className="home-knob">
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 6l-6 6 6 6" />
                <path d="M15 6l6 6-6 6" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
