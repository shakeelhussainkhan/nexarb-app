import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  try {
    const { priceId, userId, email } = await request.json();

    if (!priceId || !userId || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://app.nexarb.io/dashboard?upgraded=true",
      cancel_url: "https://app.nexarb.io/dashboard/billing",
      customer_email: email,
      allow_promotion_codes: true,
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId },
      },
      metadata: { userId },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
