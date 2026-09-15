import { LegalPage, Section } from "@/components/LegalPage";

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro="AnimBook subscriptions are month-to-month or yearly. You can stop them whenever you want. Here's exactly when a refund is paid out, in plain language."
      lastUpdated="2026-08-16"
    >
      <Section title="The Reader tier">
        <p>
          Free. No charge. No refund because there's nothing to refund.
        </p>
      </Section>

      <Section title="Premium tier">
        <p>
          <strong>Monthly (USD 9 / month)</strong> — you can cancel at any time. Your
          subscription stays active until the end of the billing period; we do not pro-rate
          the unused days. Refund of the most recent charge is available within
          <strong> 14 days of the charge</strong> if fewer than three AnimBooks have been
          opened in the Library.
        </p>
        <p>
          <strong>Yearly (USD 90 / year)</strong> — same cancellation policy. Refund of the
          most recent annual charge is available within <strong>30 days</strong> of the
          charge if fewer than 20 AnimBooks have been opened in the Library.
        </p>
        <p>
          Refund requests: <a href="mailto:billing@animbook.com">billing@animbook.com</a>.
          We respond in two business days.
        </p>
      </Section>

      <Section title="Studio tier">
        <p>
          <strong>Monthly (USD 49 / month)</strong> — same 14-day refund window.
        </p>
        <p>
          <strong>Yearly (USD 490 / year)</strong> — same 30-day refund window.
        </p>
        <p>
          For Starter / institutional billing above USD 5,000 / year the refund terms are
          negotiated in the contract.
        </p>
      </Section>

      <Section title="How to ask for a refund">
        <ol>
          <li>
            Email <a href="mailto:billing@animbook.com">billing@animbook.com</a> from the
            email address on the account.
          </li>
          <li>Include your last 4 digits and the date of the charge.</li>
          <li>
            Tell us, in one or two sentences, why you want the refund. (Optional. Honest
            notes help.)
          </li>
          <li>
            We approve or decline within two business days. Approved refunds reach your
            card in 5–10 business days, depending on your bank.
          </li>
        </ol>
      </Section>

      <Section title="What we don't refund">
        <ul>
          <li>
            Subscriptions older than the window above (renewals included — the 14 or 30
            days runs from the charge date).
          </li>
          <li>
            Subscriptions where the Library has been heavily used (the threshold is in the
            section above; we read room for a missed read).
          </li>
          <li>One-off AnimBook purchases (when we ship them) — handled per item.</li>
          <li>
            Chargebacks filed before asking us — we're reasonable, give us the chance first.
          </li>
        </ul>
      </Section>

      <Section title="If we change prices">
        <p>
          If we change the price of a plan mid-cycle, we notify you at least 30 days ahead.
          You can cancel without penalty from the date of the notice.
        </p>
      </Section>

      <Section title="Right of withdrawal (EU/UK)">
        <p>
          Under the Consumer Rights Directive, EU and UK consumers have a 14-day
          "withdrawal" period on digital subscriptions, counting from the day of purchase.
          You can exercise it by emailing <a href="mailto:billing@animbook.com">billing@animbook.com</a>;
          you will get a full refund. If you have actively used the service within that 14
          days and you do not want to give up your usage, the 14-day refund thresholds
          above apply instead.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          MiniMax Studios Limited · AnimBook · Lagos ·
          {" "}<a href="mailto:billing@animbook.com">billing@animbook.com</a>
        </p>
      </Section>
    </LegalPage>
  );
}
