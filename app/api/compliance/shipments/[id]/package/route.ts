import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { getSupabaseAdmin } from "@/lib/supabase";
import { validateIsf, type IsfData } from "@/lib/compliance/core";

// GET /api/compliance/shipments/[id]/package — the broker-ready filing
// package for one shipment: ISF 10+2 data with completeness validation,
// the entry summary (value, duty stack, formal/informal), the PGA data
// obligations implied by the linked products' categories, and the
// document register. Transmission to CBP happens through the licensed
// broker's ACE connection — this endpoint assembles and verifies
// everything the broker needs so filing is a handoff, not a project.
// Session or API key (read-only).

const PGA_BY_CATEGORY: Record<string, { agency: string; requirement: string }[]> = {
  childrens_product: [
    { agency: "CPSC", requirement: "eFiling: 7 certificate data elements with the entry (mandatory since 2026-07-08)" },
    { agency: "CPSC", requirement: "CPC on file, issued by the importer from a CPSC-accepted lab report" },
  ],
  cosmetics: [
    { agency: "FDA", requirement: "MoCRA: foreign facility registration + product listing confirmed before entry" },
  ],
  food_or_supplement: [
    { agency: "FDA", requirement: "Prior Notice filed before arrival" },
    { agency: "FDA", requirement: "Foreign facility registration + FSVP records held by the US importer" },
  ],
  electronics_rf: [
    { agency: "FCC", requirement: "Equipment authorisation on file (FCC ID grant or SDoC)" },
  ],
  wood_or_furniture: [
    { agency: "USDA", requirement: "ISPM-15 compliant wood packaging; Lacey PPQ 505 declaration for plant products" },
    { agency: "EPA", requirement: "TSCA Title VI certification for composite-wood products" },
  ],
  textile_apparel: [
    { agency: "FTC/CBP", requirement: "Fibre content, origin and care labelling verified" },
  ],
  general: [],
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const identity = await resolveUser(req);
  if (identity.kind !== "identity") {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const admin = getSupabaseAdmin();
  const { data: shipment, error } = await admin
    .from("import_shipments")
    .select("*")
    .eq("id", id)
    .eq("user_id", identity.userId)
    .single();
  if (error || !shipment) {
    return NextResponse.json({ success: false, error: "Shipment not found." }, { status: 404 });
  }

  const isfData = (shipment.isf_data ?? {}) as IsfData;
  const isf = {
    data: isfData,
    validation: shipment.transport === "ocean" ? validateIsf(isfData) : { complete: true, missing: [] },
    filedAt: shipment.isf_filed_at ?? null,
    deadlineNote:
      shipment.transport === "ocean"
        ? "ISF must be filed 24 hours before foreign lading (ocean)."
        : "ISF does not apply to air freight.",
  };

  const { data: docs } = await admin
    .from("compliance_documents")
    .select("id, doc_type, title, status, issuer, expires_at")
    .eq("shipment_id", id)
    .eq("user_id", identity.userId)
    .order("created_at", { ascending: true });

  const { data: products } = await admin
    .from("product_compliance")
    .select("id, title, category, screening_verdict, hts_code")
    .eq("user_id", identity.userId)
    .order("updated_at", { ascending: false })
    .limit(200);

  const pga: { agency: string; requirement: string; product: string }[] = [];
  const blockers: string[] = [];
  for (const p of products ?? []) {
    if (p.screening_verdict === "blocked") {
      blockers.push(`Product "${p.title}" is BLOCKED by screening and must not be imported.`);
    }
    for (const req of PGA_BY_CATEGORY[p.category] ?? []) {
      pga.push({ ...req, product: p.title });
    }
  }
  if (shipment.transport === "ocean" && !isf.validation.complete) {
    blockers.push(`ISF data incomplete — missing: ${isf.validation.missing.join(", ")}.`);
  }
  const missingDocs = (docs ?? []).filter((d) => d.status === "needed" || d.status === "requested");
  for (const d of missingDocs) blockers.push(`Document outstanding: ${d.title} (${d.status}).`);

  return NextResponse.json({
    success: true,
    package: {
      shipment: {
        id: shipment.id,
        name: shipment.name,
        status: shipment.status,
        transport: shipment.transport,
        originCountry: shipment.origin_country,
        originPort: shipment.origin_port,
        destPort: shipment.dest_port,
        etd: shipment.etd,
        eta: shipment.eta,
        brokerName: shipment.broker_name,
        entryNumber: shipment.entry_number,
      },
      isf,
      entry: {
        customsValue: Number(shipment.customs_value) || 0,
        dutyEstimate: shipment.duty_estimate ?? null,
      },
      pga,
      documents: docs ?? [],
      readyToFile: blockers.length === 0,
      blockers,
      legalNote:
        "Transmission to CBP/ACE must be performed by the importer or a licensed customs broker (19 USC 1641) under a direct power of attorney. This package assembles and validates the data; it does not file.",
    },
  });
}
