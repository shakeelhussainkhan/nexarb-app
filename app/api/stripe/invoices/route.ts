import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import Stripe from "stripe";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ invoices: [] });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const { data: sub } = await getSupabaseAdmin()
      .from("nexarb_subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single();

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ invoices: [], trial: true });
    }

    const invoiceList = await stripe.invoices.list({
      customer: sub.stripe_customer_id,
      limit: 10,
    });

    const invoices = invoiceList.data.map((inv) => ({
      id: inv.id,
      date: inv.created,
      amount: inv.amount_paid / 100,
      currency: inv.currency,
      status: inv.status,
      pdf_url: inv.invoice_pdf,
      invoice_url: inv.hosted_invoice_url,
      description: inv.lines.data[0]?.description ?? "NexArb Subscription",
    }));

    return NextResponse.json({ invoices });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ invoices: [], error: message });
  }
}
