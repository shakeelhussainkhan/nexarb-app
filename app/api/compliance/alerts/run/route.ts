import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bondCheck } from "@/lib/compliance/core";
import { computeComplianceAlerts } from "@/lib/compliance/alerts";
import { sendComplianceAlert } from "@/lib/telegram/alerts";

// POST /api/compliance/alerts/run — evaluate compliance alerts (ISF
// deadlines, document expiries, bond sufficiency) and send the ones
// whose cooldown has elapsed via Telegram. Session or API key; the
// daily compliance-monitor cron calls this with the key. Sent alerts
// are logged in compliance_alerts_log for dedupe.

export async function POST(req: NextRequest) {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const userId = identity.userId;
  const now = new Date();

  const [{ data: settings }, { data: shipments }, { data: documents }] = await Promise.all([
    admin
      .from("nexarb_settings")
      .select("customs_bond_amount, trailing_duties_taxes_fees")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("import_shipments")
      .select("id, name, transport, etd, isf_filed_at, status")
      .eq("user_id", userId)
      .limit(100),
    admin
      .from("compliance_documents")
      .select("id, title, expires_at, status")
      .eq("user_id", userId)
      .limit(200),
  ]);

  const bond =
    settings?.customs_bond_amount != null
      ? (() => {
          const b = bondCheck({
            bondAmount: Number(settings.customs_bond_amount) || 0,
            trailing12mDutiesTaxesFees: Number(settings.trailing_duties_taxes_fees) || 0,
          });
          return { bondAmount: Number(settings.customs_bond_amount) || 0, utilization: b.utilization, sufficient: b.sufficient };
        })()
      : null;

  const candidates = computeComplianceAlerts({
    shipments: (shipments ?? []) as Parameters<typeof computeComplianceAlerts>[0]["shipments"],
    documents: (documents ?? []) as Parameters<typeof computeComplianceAlerts>[0]["documents"],
    bond,
    now,
  });

  let sent = 0;
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const alert of candidates) {
    const cutoff = new Date(now.getTime() - alert.cooldownHours * 3600000).toISOString();
    const { data: recent } = await admin
      .from("compliance_alerts_log")
      .select("id")
      .eq("user_id", userId)
      .eq("alert_key", alert.key)
      .gte("sent_at", cutoff)
      .limit(1);
    if (recent && recent.length > 0) {
      skipped.push(alert.key);
      continue;
    }
    const res = await sendComplianceAlert(alert.text);
    if (res.ok) {
      sent++;
      await admin.from("compliance_alerts_log").insert({ user_id: userId, alert_key: alert.key, kind: alert.kind });
    } else if (res.error) {
      errors.push(`${alert.key}: ${res.error}`);
    }
  }

  return NextResponse.json({
    success: true,
    evaluated: candidates.length,
    sent,
    skippedCooldown: skipped.length,
    errors,
  });
}
