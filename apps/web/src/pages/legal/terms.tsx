import { LegalPage, Section } from "@/components/LegalPage";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro="These terms govern your use of AnimBook, the platform that turns written manuscripts into animated, narrated reading experiences. The product is the page flip. The text is the author's. Use of the service means you accept what's below."
      lastUpdated="2026-08-16"
    >
      <Section title="1. What AnimBook is">
        <p>
          AnimBook is a platform that pairs original manuscript text with generated animation,
          narration, and ambient sound. Every page renders the author's words verbatim. The
          visual layer is generated.
        </p>
        <p>
          AnimBook Originals and AnimBook Docs are products of MiniMax Studios Limited.
          AnimBook has been conceived in Africa, with editorial guidance drawn from authors,
          educators, and theologians across the continent. Long-term headquarters is Lagos,
          Nigeria.
        </p>
      </Section>

      <Section title="2. Your account">
        <p>
          You are responsible for your account credentials and for any activity that occurs
          under your account. We support passwordless login via Clerk and demo logins for
          local development. If you believe your account has been compromised, write to
          <a href="mailto:security@animbook.com">security@animbook.com</a>.
        </p>
        <p>
          You must be at least 13 years old to use AnimBook. The KIDS vertical is designed
          for younger readers; account-level controls for parents and classrooms are in the
          AnimBook SCHOOL dashboard.
        </p>
      </Section>

      <Section title="3. The AnimBooks you read">
        <p>
          AnimBook Originals (titles produced in-house) are made available to you under a
          personal, non-exclusive, non-transferable licence for reading. AnimBook Docs is a
          K–12 instruction-ready format; BUSINESS AnimBooks ship with SCORM 2004 packaging
          for licensed seats.
        </p>
        <p>
          You may not:
        </p>
        <ul>
          <li>Record the animation or narration and redistribute it as audio or video.</li>
          <li>Use the AnimBook Reader for any commercial re-publication.</li>
          <li>Attempt to circumvent the paywall or any DREAM / STUDIO PRO gating.</li>
          <li>Scrape the platform to train a model that competes with the AnimBook Reader.</li>
        </ul>
      </Section>

      <Section title="4. The AnimBooks you write">
        <p>
          If you are an AnimBook Studio author, you retain copyright in the manuscript text
          you upload. AnimBook retains rights in the animation, narration, and video
          assembly pipeline. The licence on derivative AnimBooks is set per project, with
          revenue share at industry standard (see <a href="/creator">Creator</a>).
        </p>
      </Section>

      <Section title="5. Fair use of manuscripts">
        <p>
          AnimBook participates in good-faith public-domain and licensed programmes.
          Public-domain titles include the original Beatrix Potter canon (now in the public
          domain in most jurisdictions), Shakespeare, and any title on the original 11
          AnimBooks we seeded. We will remove any title on a credible claim of rightsholder
          objection — write to <a href="mailto:rights@animbook.com">rights@animbook.com</a>.
        </p>
      </Section>

      <Section title="6. Privacy and data">
        <p>
          How we handle personal data is described in the
          {" "}<a href="/legal/privacy">Privacy Policy</a>. By using AnimBook you accept that
          policy.
        </p>
      </Section>

      <Section title="7. Termination">
        <p>
          You may close your account at any time from <a href="/profile">your profile</a>.
          Your reading history, library progress, and personal identifiers will be deleted;
          an audit row will be retained as required by GDPR Art. 30.
        </p>
        <p>
          We may suspend accounts that attempt to scrape, harvest, or otherwise disrupt the
          service. We try to give notice; we won't always succeed.
        </p>
      </Section>

      <Section title="8. No warranty">
        <p>
          AnimBook is provided as-is. The page flip is sacred; everything else is built
          carefully and may break. We are not liable for indirect damages, including lost
          reading hours, broken narration, or sleepy pets.
        </p>
      </Section>

      <Section title="9. Governing law and disputes">
        <p>
          These terms are governed by the laws of the Federal Republic of Nigeria. Disputes
          will be resolved in the courts of Lagos State, except where the consumer's local
          law grants them additional protection that cannot be waived.
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          When we make material changes we update the "Last updated" date above and
          notify active Premium accounts by email. Smaller changes (typos, link fixes)
          happen quietly.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          MiniMax Studios Limited · AnimBook. Write to
          {" "}<a href="mailto:legal@animbook.com">legal@animbook.com</a> for any question
          about these terms.
        </p>
      </Section>
    </LegalPage>
  );
}
