import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bondCheck, complianceChecklist, type ProductCategory } from "@/lib/compliance/core";

// GET /api/compliance/overview — one read for the compliance dashboard
// and the monitor cron: importer profile + bond status, product counts
// by verdict, open exceptions (screening reviews, importer-only
// checklist items still pending), shipment deadline state, and
// documents expiring within 30 days. Session or API key (read-only).

export async function GET(req: NextRequest) {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const userId = identity.userId;

  const [{ data: settings }, { data: products }, { data: shipments }, { data: documents }] =
    await Promise.all([
      admin
        .from("nexarb_settings")
        .select("ior_legal_name, customs_bond_amount, customs_bond_provider, customs_broker_name, trailing_duties_taxes_fees")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("product_compliance")
        .select("id, title, category, screening_verdict, screening_reasons, checklist_status")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(200),
      admin
        .from("import_shipments")
        .select("id, name, status, transport, etd, eta, isf_filed_at, entry_number")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("compliance_documents")
        .select("id, doc_type, title, status, expires_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  const now = Date.now();
  const day = 86400000;
  const exceptions: { kind: string; label: string; productId?: string }[] = [];
  const counts = { clear: 0, review: 0, blocked: 0 };
  for (const p of products ?? []) {
    if (p.screening_verdict === "review") {
      counts.review++;
      exceptions.push({ kind: "ip_review", label: `"${p.title}" needs an IP review before purchase.`, productId: p.id });
    } else if (p.screening_verdict === "blocked") {
      counts.blocked++;
      exceptions.push({ kind: "blocked", label: `"${p.title}" is BLOCKED by screening — do not import.`, productId: p.id });
    } else counts.clear++;
    // Importer-only (manual_by_law) checklist items still pending are the
    // owner's personal queue — signatures and attestations software
    // cannot do for them.
    const statuses = (p.checklist_status ?? {}) as Record<string, string>;
    for (const item of complianceChecklist((p.category ?? "general") as ProductCategory)) {
      if (item.automation === "manual_by_law" && statuses[item.key] !== "done" && statuses[item.key] !== "na") {
        exceptions.push({
          kind: "importer_action",
          label: `"${p.title}": ${item.title} — importer action required.`,
          productId: p.id,
        });
      }
    }
  }

  const shipmentAlerts: { kind: string; label: string; shipmentId: string }[] = [];
  for (const s of shipments ?? []) {
    if (s.transport === "ocean" && !s.isf_filed_at && s.etd) {
      const etdMs = new Date(s.etd as string).getTime();
      const hoursToDeadline = (etdMs - 24 * 3600000 - now) / 3600000;
      if (hoursToDeadline < 72 && !["released", "delivered", "cancelled"].includes(s.status)) {
        shipmentAlerts.push({
          kind: "isf_deadline",
          label: `"${s.name}": ISF deadline ${hoursToDeadline < 0 ? "PASSED" : `in ${Math.round(hoursToDeadline)}h`} (24h before lading) and ISF is not filed.`,
          shipmentId: s.id,
        });
      }
    }
  }

  const expiringDocuments = (documents ?? []).filter(
    (d) => d.expires_at && new Date(d.expires_at as string).getTime() - now < 30 * day && d.status !== "expired"
  );

  const bond =
    settings?.customs_bond_amount != null
      ? bondCheck({
          bondAmount: Number(settings.customs_bond_amount) || 0,
          trailing12mDutiesTaxesFees: Number(settings.trailing_duties_taxes_fees) || 0,
        })
      : null;

  return NextResponse.json({
    success: true,
    overview: {
      importer: {
        legalName: settings?.ior_legal_name ?? null,
        brokerName: settings?.customs_broker_name ?? null,
        bondProvider: settings?.customs_bond_provider ?? null,
        bondAmount: settings?.customs_bond_amount ?? null,
      },
      bond,
      productCounts: counts,
      productTotal: (products ?? []).length,
      exceptions,
      shipments: shipments ?? [],
      shipmentAlerts,
      expiringDocuments,
    },
  });
}
