/**
 * Stripe subscription client (stub-grade).
 *
 * Returns deterministic fake checkout URLs when the key is missing so the
 * frontend can drive a "demo subscription" flow without leaking internal
 * account state.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export interface CheckoutInput {
  userId: string;
  plan: "PREMIUM" | "ENTERPRISE";
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  sessionId: string;
  source: "stripe" | "stub";
}

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutResult> {
  if (!isFeatureEnabled("STRIPE")) {
    return {
      url: `${input.successUrl}?demo_checkout=1&plan=${input.plan}`,
      sessionId: `stub_${Date.now()}`,
      source: "stub"
    };
  }
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.userId);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", input.plan === "ENTERPRISE" ? "49900" : "9900");
  params.set("line_items[0][price_data][recurring][interval]", "month");
  params.set("line_items[0][price_data][product_data][name]", `AnimBook ${input.plan}`);
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appEnv.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  if (!response.ok) {
    throw new Error(`Stripe checkout failed: ${response.status}`);
  }
  const json = (await response.json()) as { id: string; url: string };
  return { url: json.url, sessionId: json.id, source: "stripe" };
}

export const stripeStatus = { live: isFeatureEnabled("STRIPE") };