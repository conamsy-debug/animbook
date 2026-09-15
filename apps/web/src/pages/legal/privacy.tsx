import { LegalPage, Section } from "@/components/LegalPage";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="AnimBook handles a small amount of personal data: your account, what you read, and the choices you make in the Reader. This page says what we collect, why, how long we keep it, and how to leave with all of it."
      lastUpdated="2026-08-16"
    >
      <Section title="1. Who we are">
        <p>
          AnimBook is a product of MiniMax Studios Limited, Lagos. We are the data
          controller for the personal data described below. Data Protection Officer:
          {" "}<a href="mailto:dpo@animbook.com">dpo@animbook.com</a>.
        </p>
      </Section>

      <Section title="2. What we collect">
        <ul>
          <li>
            <strong>Account</strong> — email, name, optional Clerk id, optional Stripe
            customer id. We never store passwords (Clerk stores those for us).
          </li>
          <li>
            <strong>Library</strong> — the AnimBooks you've saved, your reading progress,
            which mode you used (Watch / Read+Watch / Read), and the language preference
            for narration.
          </li>
          <li>
            <strong>Adaptive profile (MEMORY)</strong> — palette, pacing, narration
            speed, font size, motion level, and the Lens / Echo toggles. These are
            inferential; we don't see specific page views tied to them.
          </li>
          <li>
            <strong>Reading telemetry</strong> — dwell time per page, scroll-back events,
            abandonment. Aggregated; no precise location; never shared with advertisers.
          </li>
          <li>
            <strong>DREAM drift log</strong> — page count, ambient track, fell-asleep
            flag. Stored until you close your account or 12 months, whichever is first.
          </li>
          <li>
            <strong>Payment</strong> — Stripe holds the card and billing address; we
            keep the subscription id, plan, status, and the last 4 digits of the card.
          </li>
        </ul>
      </Section>

      <Section title="3. Why we collect it">
        <ul>
          <li>To run the service (open the right book at the right page).</li>
          <li>To improve the AnimBook Reader (know what works, fix what doesn't).</li>
          <li>To bill you (subscriptions and SCORM seat counts).</li>
          <li>To stay in touch when you ask us to.</li>
        </ul>
        <p>
          We do not sell your data. We do not pass your Library or Memory profile to any
          third party. We do not run ads.
        </p>
      </Section>

      <Section title="4. Legal basis">
        <p>
          GDPR Art. 6 — we rely on <strong>contract</strong> (to deliver the service),{" "}
          <strong>legitimate interest</strong> (to improve the platform and prevent abuse),
          and <strong>consent</strong> (for telemetry and notifications).
        </p>
      </Section>

      <Section title="5. Where the data lives">
        <p>
          The AnimBook application runs in the EU and the UK by default. The database is
          PostgreSQL on managed infrastructure; the cache layer is Redis; assets live in
          Cloudflare R2 in the EU region. Stripe handles payments under their DPA. Clerk
          handles authentication under theirs.
        </p>
      </Section>

      <Section title="6. How long we keep it">
        <ul>
          <li>Account — until you close it.</li>
          <li>Library + reading progress — until you close it.</li>
          <li>Memory profile — until you close it.</li>
          <li>Telemetry — 12 months aggregated.</li>
          <li>DREAM drift log — 12 months.</li>
          <li>Deletion audit row — 7 years (GDPR Art. 30 / Nigerian Data Protection Act).</li>
        </ul>
      </Section>

      <Section title="7. Your rights">
        <ul>
          <li>
            <strong>Access & portability (Art. 15, 20)</strong> — export everything we
            hold about you from the <a href="/profile">profile page</a>.
          </li>
          <li>
            <strong>Erasure (Art. 17)</strong> — delete your account from the profile
            page; we keep the audit row, and nothing else.
          </li>
          <li>
            <strong>Rectification (Art. 16)</strong> — email{" "}
            <a href="mailto:dpo@animbook.com">dpo@animbook.com</a>.
          </li>
          <li>
            <strong>Object (Art. 21)</strong> — turn off Memory, telemetry, and notifications
            from the profile page.
          </li>
          <li>
            <strong>Complain</strong> — to your local data protection authority. In
            Nigeria, the Nigeria Data Protection Commission (NDPC).
          </li>
        </ul>
      </Section>

      <Section title="8. Cookies">
        <p>
          We use a single first-party cookie for the Clerk session. The service worker for
          offline reading lives on your device. We do not run third-party trackers.
        </p>
      </Section>

      <Section title="9. Children">
        <p>
          AnimBook is open to readers aged 13 and above. The KIDS vertical is for younger
          readers; KIDS accounts are managed by parents and schools. We do not knowingly
          collect data from children under 13 outside that controlled environment. See{" "}
          <a href="/school">AnimBook SCHOOL</a> for institutional use.
        </p>
      </Section>

      <Section title="10. Updates">
        <p>
          When we make material changes we update the "Last updated" date above and notify
          active subscribers. Previous versions are kept at
          {" "}<a href="/legal/privacy/history">/legal/privacy/history</a>.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          MiniMax Studios Limited · AnimBook · Lagos ·{" "}
          <a href="mailto:privacy@animbook.com">privacy@animbook.com</a>
        </p>
      </Section>
    </LegalPage>
  );
}
