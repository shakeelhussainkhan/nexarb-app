import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

function planFromPriceId(priceId: string): string {
  const map: Record<string, string> = {
    price_1U1vBNEkm3bbs6z6zN4sE4yS: "solo",
    price_1U1vCjEkm3bbs6z6MYO2It39: "professional",
    price_1U1vDYEkm3bbs6z6h2RtUp0E: "agency",
  };
  return map[priceId] ?? "free";
}

function periodEnd(sub: Stripe.Subscription): string | null {
  const ts = sub.billing_schedules?.[0]?.bill_until?.computed_timestamp;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const email = session.customer_email ?? "";
        const subscriptionId = session.subscription as string;

        if (!userId || !subscriptionId) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price?.id ?? "";
        const plan = planFromPriceId(priceId);

        await getSupabaseAdmin().from("nexarb_subscriptions").upsert(
          {
            user_id: userId,
            email,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subscriptionId,
            plan,
            status: sub.status,
            trial_ends_at: sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : null,
            current_period_end: periodEnd(sub),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        const priceId = sub.items.data[0]?.price?.id ?? "";
        const plan = planFromPriceId(priceId);

        if (!userId) break;

        await getSupabaseAdmin()
          .from("nexarb_subscriptions")
          .update({
            plan,
            status: sub.status,
            trial_ends_at: sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : null,
            current_period_end: periodEnd(sub),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;

        if (!userId) break;

        await getSupabaseAdmin()
          .from("nexarb_subscriptions")
          .update({
            plan: "free",
            status: "canceled",
            stripe_subscription_id: null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
        break;
      }
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
