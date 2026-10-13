// US import-compliance core for NexArb (pure functions; unit-tested by
// scripts/verify-compliance.mjs). Built from the 2026-10-13 import-
// compliance research (CBP / Federal Register sources). This module
// automates everything the law allows software to do: screening,
// duty math, document checklists, filing-data validation. It never
// replaces the importer of record's legal judgments — items that need
// a human or a licensed broker are labelled as such in the checklist.
//
// Tariff parameters are CONFIG, not gospel: rates change by executive
// action (2025-26 proved that repeatedly). Update TARIFF_2026 only
// with a dated source.

export const TARIFF_2026 = {
  /** China Section 301 (Lists 1-3 / 4A). List 4B was never implemented. */
  section301: { list1: 0.25, list2: 0.25, list3: 0.25, list4a: 0.075, none: 0 },
  /** Flat Section 301 forced-labour duty on China since 2026-07-24 (HTS 9903.05.31). */
  chinaForcedLabour: 0.125,
  /** Section 232 metals (restructured 2026-04-06). */
  section232Metal: 0.5,
  section232Derivative: 0.25,
  /** Merchandise Processing Fee: 0.3464% with FY2027 min/max (single-source max/min — verify at entry). */
  mpfRate: 0.003464,
  mpfMin: 34.58,
  mpfMax: 670.86,
  /** Harbor Maintenance Fee (ocean only). */
  hmfRate: 0.00125,
  /** Formal-entry threshold (19 USC 1498). */
  formalEntryThreshold: 2500,
  /** Continuous bond minimum (10% of prior-12-month duties/taxes/fees). */
  continuousBondMin: 50000,
} as const;

export type Section301List = keyof typeof TARIFF_2026.section301;

// --- Product categories ------------------------------------------------------

export type ProductCategory =
  | "childrens_product"
  | "cosmetics"
  | "food_or_supplement"
  | "electronics_rf"
  | "textile_apparel"
  | "wood_or_furniture"
  | "general";

const CATEGORY_SIGNALS: Array<{ category: ProductCategory; terms: string[] }> = [
  {
    category: "childrens_product",
    terms: ["toy", "kids", "children", "child", "baby", "infant", "toddler", "nursery", "playpen", "stroller", "teether"],
  },
  {
    category: "cosmetics",
    terms: ["cream", "lotion", "serum", "makeup", "lipstick", "shampoo", "conditioner", "face mask", "skincare", "nail polish", "perfume"],
  },
  {
    category: "food_or_supplement",
    terms: ["supplement", "vitamin", "gummies", "protein powder", "snack", "tea leaves", "coffee beans", "spice", "candy"],
  },
  {
    category: "electronics_rf",
    terms: ["bluetooth", "wifi", "wi-fi", "wireless earbuds", "wireless headphones", "smart watch", "smartwatch", "drone", "remote control", "5g", "lora", "rf remote"],
  },
  {
    category: "textile_apparel",
    terms: ["t-shirt", "hoodie", "dress", "fabric", "cotton shirt", "apparel", "garment", "bedding", "towel set", "curtain"],
  },
  {
    category: "wood_or_furniture",
    terms: ["wooden", "bamboo", "furniture", "wood table", "wood chair", "plywood", "cutting board"],
  },
];

/** Best-guess category from a product title. First matching signal wins;
 * children's products are checked first because they carry the heaviest
 * regime (CPC + eFiling) and must never be missed. */
export function detectCategory(title: string): ProductCategory {
  const t = ` ${title.toLowerCase()} `;
  for (const { category, terms } of CATEGORY_SIGNALS) {
    if (terms.some((term) => t.includes(term))) return category;
  }
  return "general";
}

// --- Screening: prohibited goods + IP risk -----------------------------------

/** Terms that indicate goods CBP will seize or that cannot lawfully be
 * imported/sold: counterfeits-by-admission, drug paraphernalia, weapons,
 * sanctioned-origin goods, banned materials. */
const PROHIBITED_TERMS: Array<{ term: string; reason: string }> = [
  { term: "replica", reason: "Counterfeit indicator — 'replica' branded goods are seized under 19 USC 1526." },
  { term: "knockoff", reason: "Counterfeit indicator." },
  { term: "knock-off", reason: "Counterfeit indicator." },
  { term: "fake designer", reason: "Counterfeit indicator." },
  { term: "aaa quality", reason: "Counterfeit-trade slang for imitation branded goods." },
  { term: "xinjiang", reason: "UFLPA rebuttable presumption — Xinjiang-origin goods are detained; entry requires a clear-and-convincing tracing file." },
  { term: "ivory", reason: "Endangered-species material — import restricted/banned (ESA / Lacey Act)." },
  { term: "tortoiseshell", reason: "Endangered-species material — import restricted (CITES)." },
  { term: "dog fur", reason: "Dog and cat fur is prohibited (19 USC 1308)." },
  { term: "cat fur", reason: "Dog and cat fur is prohibited (19 USC 1308)." },
  { term: "switchblade", reason: "Switchblade knives are restricted (15 USC 1241-1245)." },
  { term: "brass knuckles", reason: "Weapons category — restricted in multiple states and on Amazon." },
  { term: "drug paraphernalia", reason: "Drug paraphernalia is prohibited to import (21 USC 863)." },
  { term: "kratom", reason: "FDA import alert — kratom is detained without physical examination." },
  { term: "hgh", reason: "Human growth hormone — restricted pharmaceutical (21 USC 333(e))." },
];

/** Major brands whose names in a generic supplier's listing mean the goods
 * are counterfeit, grey-market, or unauthorised overruns — the highest-risk
 * pattern in Alibaba sourcing. Presence = REVIEW (never auto-block: the
 * product may be a legitimate compatible accessory, which is its own
 * nominative-fair-use question for a human). */
const BRAND_WATCHLIST = [
  "nike", "adidas", "apple", "samsung", "sony", "lg", "dyson", "lego",
  "disney", "marvel", "pokemon", "nintendo", "kitchenaid", "stanley",
  "yeti", "hydro flask", "lululemon", "gucci", "louis vuitton", "chanel",
  "rolex", "bosch", "dewalt", "makita", "3m", "sharpie", "crayola",
];

export type ScreeningVerdict = "clear" | "review" | "blocked";

export interface ScreeningResult {
  verdict: ScreeningVerdict;
  category: ProductCategory;
  reasons: string[];
}

/** Screen a product (title + supplier) against prohibited-goods terms and
 * the brand watchlist. BLOCKED = a prohibited term matched; REVIEW = a
 * watchlist brand appears; CLEAR otherwise. Screening is a software
 * control, not a legal clearance — final judgment stays with the importer. */
export function screenProduct(input: { title: string; supplierName?: string | null }): ScreeningResult {
  const haystack = ` ${(`${input.title} ${input.supplierName ?? ""}`).toLowerCase()} `;
  const reasons: string[] = [];
  let blocked = false;
  let review = false;
  for (const { term, reason } of PROHIBITED_TERMS) {
    if (haystack.includes(term)) {
      blocked = true;
      reasons.push(`BLOCKED — "${term}": ${reason}`);
    }
  }
  for (const brand of BRAND_WATCHLIST) {
    if (haystack.includes(` ${brand} `) || haystack.includes(`${brand} `) && haystack.startsWith(` ${brand}`)) {
      review = true;
      reasons.push(
        `IP REVIEW — brand "${brand}" appears in the listing. Branded goods from generic suppliers are counterfeit/grey-market until proven otherwise (licence or authorised-source invoices required).`
      );
    }
  }
  return {
    verdict: blocked ? "blocked" : review ? "review" : "clear",
    category: detectCategory(input.title),
    reasons,
  };
}

// --- Tariff stack / landed-duty estimate -------------------------------------

export interface DutyInput {
  customsValue: number;
  originCountry: string; // ISO-2
  mfnRate: number; // column-1 rate for the HTS code, 0..1
  section301List?: Section301List;
  section232?: "metal" | "derivative" | null;
  adcvdRate?: number; // combined AD/CVD rate when a case covers the scope, 0..1
  ocean?: boolean; // HMF applies to ocean freight
}

export interface DutyLine {
  label: string;
  rate: number | null; // null for value-based fees
  amount: number;
}

export interface DutyEstimate {
  lines: DutyLine[];
  totalDuty: number; // duties only (no MPF/HMF)
  totalFees: number; // MPF + HMF
  total: number; // duty + fees
  effectiveRate: number; // total / customsValue
  formalEntry: boolean;
}

/**
 * Estimate the full US duty stack for a China-origin (or other) shipment.
 * Reproduces the research report's worked example: $20,000 value, 5% MFN,
 * List 4A, ocean → $5,000 duty (MFN $1,000 + 301 $1,500 + forced-labour
 * $2,500), $94.28 fees, 25.47% effective.
 */
export function estimateDuties(input: DutyInput): DutyEstimate {
  const v = Math.max(0, input.customsValue);
  const lines: DutyLine[] = [];
  const china = input.originCountry.toUpperCase() === "CN";
  let duty = 0;
  const addDuty = (label: string, rate: number) => {
    if (rate <= 0) return;
    const amount = v * rate;
    duty += amount;
    lines.push({ label, rate, amount });
  };
  addDuty("MFN (column 1)", input.mfnRate);
  if (china && input.section301List) {
    addDuty(`Section 301 (${input.section301List})`, TARIFF_2026.section301[input.section301List]);
  }
  if (china) addDuty("Section 301 forced-labour (9903.05.31)", TARIFF_2026.chinaForcedLabour);
  if (input.section232 === "metal") addDuty("Section 232 (metal)", TARIFF_2026.section232Metal);
  if (input.section232 === "derivative") addDuty("Section 232 (derivative)", TARIFF_2026.section232Derivative);
  addDuty("AD/CVD", input.adcvdRate ?? 0);

  let fees = 0;
  if (v > 0) {
    const mpf = Math.min(TARIFF_2026.mpfMax, Math.max(TARIFF_2026.mpfMin, v * TARIFF_2026.mpfRate));
    fees += mpf;
    lines.push({ label: "MPF (0.3464%, min/max applied)", rate: null, amount: mpf });
    if (input.ocean) {
      const hmf = v * TARIFF_2026.hmfRate;
      fees += hmf;
      lines.push({ label: "HMF (0.125%, ocean)", rate: null, amount: hmf });
    }
  }
  const total = duty + fees;
  return {
    lines,
    totalDuty: duty,
    totalFees: fees,
    total,
    effectiveRate: v > 0 ? total / v : 0,
    formalEntry: v > TARIFF_2026.formalEntryThreshold,
  };
}

/** Bond sufficiency: a continuous bond must be ≥ 10% of trailing-12-month
 * duties/taxes/fees and ≥ $50,000. At 2026 China rates the $50k minimum
 * supports only ~$500k of annual duty — flag utilisation early. */
export function bondCheck(input: { bondAmount: number; trailing12mDutiesTaxesFees: number }): {
  required: number;
  sufficient: boolean;
  utilization: number; // trailing / (bond * 10)
  headroom: number; // max additional duty the bond supports
} {
  const required = Math.max(TARIFF_2026.continuousBondMin, input.trailing12mDutiesTaxesFees * 0.1 * 1.0);
  const capacity = input.bondAmount * 10;
  return {
    required,
    sufficient: input.bondAmount >= required && input.trailing12mDutiesTaxesFees <= capacity,
    utilization: capacity > 0 ? input.trailing12mDutiesTaxesFees / capacity : 0,
    headroom: Math.max(0, capacity - input.trailing12mDutiesTaxesFees),
  };
}

// --- Compliance checklist per category ----------------------------------------

export type ChecklistOwner = "platform" | "broker" | "importer" | "supplier" | "lab";
export type ChecklistAutomation = "automated" | "broker_api" | "manual_by_law";

export interface ChecklistItem {
  key: string;
  title: string;
  detail: string;
  owner: ChecklistOwner;
  automation: ChecklistAutomation;
}

const BASE_ITEMS: ChecklistItem[] = [
  { key: "hts", title: "HTS classification", detail: "Assign the 10-digit HTS code; the platform suggests, the importer (or broker under POA) makes the final call — reasonable care, 19 USC 1484.", owner: "importer", automation: "manual_by_law" },
  { key: "adcvd", title: "AD/CVD scope check", detail: "Search Commerce ACCESS by product scope (not just HTS) — China cases can exceed 200% combined.", owner: "platform", automation: "automated" },
  { key: "origin_marking", title: "Country-of-origin marking", detail: "Conspicuous, legible, indelible English marking reaching the ultimate purchaser (19 USC 1304); unmarked goods draw 10% marking duties.", owner: "supplier", automation: "automated" },
  { key: "invoice_packing", title: "Commercial invoice + packing list", detail: "English invoice with HTS, values, quantities, origin; collected from the supplier and validated before shipment.", owner: "supplier", automation: "automated" },
  { key: "isf", title: "ISF 10+2 (ocean)", detail: "Filed 24h before foreign lading via the broker's ACE connection; the platform assembles and validates the 10 importer elements and controls the deadline.", owner: "broker", automation: "broker_api" },
  { key: "entry", title: "Customs entry (ACE)", detail: "Formal entry (>$2,500) transmitted by the licensed broker under a direct POA; entry number and release status recorded here.", owner: "broker", automation: "broker_api" },
  { key: "bond", title: "Bond coverage", detail: "Continuous bond ≥10% of trailing-12-month duties/taxes/fees (min $50,000); platform monitors utilisation.", owner: "platform", automation: "automated" },
  { key: "prop65", title: "California Prop 65 assessment", detail: "Per-SKU: test or warn. Online listings need the warning on the product display page; short-form warnings must name a chemical for products made on/after 2028-01-01.", owner: "importer", automation: "manual_by_law" },
  { key: "records", title: "5-year record archive", detail: "Entry documents kept 5 years (19 CFR Part 163) in the importer's own archive — the broker's copies do not discharge this duty.", owner: "platform", automation: "automated" },
  { key: "uflpa", title: "UFLPA supply-chain file", detail: "Supplier and sub-supplier tracing evidence held ready: Xinjiang/Entity-List goods are presumed forced-labour and detained; rebuttal needs clear-and-convincing evidence.", owner: "importer", automation: "manual_by_law" },
];

const CATEGORY_ITEMS: Record<ProductCategory, ChecklistItem[]> = {
  general: [],
  childrens_product: [
    { key: "cpc", title: "Children's Product Certificate (CPC)", detail: "Issued and attested by the importer of record (never delegable), citing each applicable CPSC rule, based on a CPSC-accepted lab's test report.", owner: "importer", automation: "manual_by_law" },
    { key: "lab_test", title: "CPSC-accepted lab testing", detail: "Lead ≤100 ppm substrate / ≤90 ppm paint; 8 phthalates ≤0.1% each; ASTM F963-23 mandatory for toys.", owner: "lab", automation: "broker_api" },
    { key: "tracking_labels", title: "Tracking labels", detail: "Permanent, distinguishing labels on product and packaging tracing manufacture date/place and production run.", owner: "supplier", automation: "automated" },
    { key: "cpsc_efiling", title: "CPSC eFiling (ACE)", detail: "Mandatory since 2026-07-08: 7 certificate data elements transmitted with the entry (Full message set or Product Registry reference). No value exemption.", owner: "broker", automation: "broker_api" },
  ],
  cosmetics: [
    { key: "mocra_facility", title: "MoCRA facility registration", detail: "The foreign manufacturing facility must be registered (via the US responsible person) before import.", owner: "importer", automation: "manual_by_law" },
    { key: "mocra_listing", title: "MoCRA product listing", detail: "Each marketed cosmetic listed with ingredients via Cosmetics Direct; cosmetic-drug claims turn the product into a drug — check claims before buying.", owner: "importer", automation: "manual_by_law" },
  ],
  food_or_supplement: [
    { key: "fda_facility", title: "FDA facility registration", detail: "Foreign facility registered with FDA before shipment.", owner: "supplier", automation: "automated" },
    { key: "prior_notice", title: "FDA Prior Notice", detail: "Filed before the goods arrive (via broker ACE or FDA PNSI).", owner: "broker", automation: "broker_api" },
    { key: "fsvp", title: "FSVP records", detail: "The US importer is the FSVP importer: supplier verification records must exist and be producible within 24h of an FDA request.", owner: "importer", automation: "manual_by_law" },
  ],
  electronics_rf: [
    { key: "fcc_auth", title: "FCC authorisation", detail: "RF transmitters need Certification (FCC ID) from a TCB; SDoC devices make the US importer the responsible party. No authorisation = no lawful import/sale.", owner: "importer", automation: "manual_by_law" },
  ],
  textile_apparel: [
    { key: "ftc_labels", title: "FTC textile labelling", detail: "Fibre content, country of origin, and RN/identity on labels; care labelling per ASTM D5489. Cumulative with CBP marking.", owner: "supplier", automation: "automated" },
  ],
  wood_or_furniture: [
    { key: "ispm15", title: "ISPM-15 wood packaging", detail: "All wood packaging material heat-treated and stamped; non-compliant packaging is exported or destroyed at the importer's cost.", owner: "supplier", automation: "automated" },
    { key: "tsca_title6", title: "TSCA Title VI (composite wood)", detail: "Composite-wood products need certification by an EPA-recognised certifier and compliant labelling.", owner: "lab", automation: "broker_api" },
    { key: "lacey", title: "Lacey Act declaration", detail: "Plant/wood products require a PPQ 505 declaration of genus, species, and harvest country.", owner: "broker", automation: "broker_api" },
  ],
};

/** The full document/filing checklist for a product of this category. */
export function complianceChecklist(category: ProductCategory): ChecklistItem[] {
  return [...BASE_ITEMS, ...(CATEGORY_ITEMS[category] ?? [])];
}

// --- ISF data validation -------------------------------------------------------

export interface IsfData {
  importerOfRecord?: string;
  consignee?: string;
  sellerNameAddress?: string;
  buyerNameAddress?: string;
  shipToNameAddress?: string;
  manufacturerNameAddress?: string;
  countryOfOrigin?: string;
  htsCode?: string;
  containerStuffingLocation?: string;
  consolidatorNameAddress?: string;
}

const ISF_FIELDS: Array<{ key: keyof IsfData; label: string }> = [
  { key: "importerOfRecord", label: "Importer of record number" },
  { key: "consignee", label: "Consignee number" },
  { key: "sellerNameAddress", label: "Seller name & address" },
  { key: "buyerNameAddress", label: "Buyer name & address" },
  { key: "shipToNameAddress", label: "Ship-to name & address" },
  { key: "manufacturerNameAddress", label: "Manufacturer name & address" },
  { key: "countryOfOrigin", label: "Country of origin" },
  { key: "htsCode", label: "HTS code (6+ digits)" },
  { key: "containerStuffingLocation", label: "Container stuffing location" },
  { key: "consolidatorNameAddress", label: "Consolidator name & address" },
];

/** Validate an ISF data set for completeness (the 10 importer elements).
 * Returns the missing field labels; an empty list means ready to hand to
 * the broker. (The 2 carrier elements come from the carrier/broker.) */
export function validateIsf(data: IsfData): { complete: boolean; missing: string[] } {
  const missing = ISF_FIELDS.filter(({ key }) => {
    const v = data[key];
    return typeof v !== "string" || v.trim().length < 2;
  }).map(({ label }) => label);
  return { complete: missing.length === 0, missing };
}
