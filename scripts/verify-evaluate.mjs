// Offline harness for the supplier-offer evaluation core
// (lib/suppliers/evaluateCore.ts): freight-aware verdict rules, velocity
// classes, the Q4 seasonal boost, gated candidates, and eligibility/stock
// edges. Every rule branch in the core's header contract is exercised.
// Run: node --experimental-strip-types --loader ./scripts/alias-loader.mjs scripts/verify-evaluate.mjs
// Pure-logic tests — NO network, NO database.
import {
  evaluateOffer,
  classifyVelocity,
  seasonalGroupsFor,
  CANDIDATE_MIN_NET,
  CANDIDATE_MIN_MARGIN_PCT,
} from "@/lib/suppliers/evaluateCore.ts";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}
const near = (a, b, eps = 0.011) => typeof a === "number" && Math.abs(a - b) <= eps;
const hasReason = (ev, frag) => ev.reasons.some((r) => r.includes(frag));

// DieHard-style economics (mirrors a real priced Petra row): base net
// $9.52 / 38.1% before freight.
const BATTERY = {
  supplier: "petra",
  title: "DieHard AA Alkaline Battery 16 Pack",
  brand: "DieHard",
  productClass: null,
  subcategory: null,
  costPrice: 4.49,
};
const STRONG_SIGNALS = {
  amazonPrice: 24.95,
  bsr: 5000,
  category: null,
  eligibility: "ELIGIBLE",
  stockAtSupplier: 5,
};

// --- candidate happy path + default freight model ---------------------------
{
  const ev = evaluateOffer(BATTERY, STRONG_SIGNALS);
  check("candidate: verdict", ev.verdict === "candidate", ev.verdict);
  check("freight: default 8% of cost", near(ev.freightPerUnit, 0.36), `got ${ev.freightPerUnit}`);
  check("freight: net after freight", near(ev.freightNet, 9.16), `got ${ev.freightNet}`);
  check("freight: margin after freight", near(ev.freightMarginPct, 36.7, 0.11), `got ${ev.freightMarginPct}`);
  check("freight: base net preserved", near(ev.baseNet, 9.52), `got ${ev.baseNet}`);
  check("freight: reason states the assumption",
    hasReason(ev, "8% of supplier cost") && hasReason(ev, "below the $800 free-freight threshold"),
    ev.reasons.join(" | "));
  check("velocity: strong from BSR 5000", ev.velocityClass === "strong", ev.velocityClass);
  check("score: in range for a strong candidate", ev.score >= 65 && ev.score <= 85, `got ${ev.score}`);
}

// --- freight-free modelling (order reaches the $800 threshold) --------------
{
  const ev = evaluateOffer(BATTERY, STRONG_SIGNALS, { freightFree: true });
  check("freightFree: $0 freight", ev.freightPerUnit === 0, `got ${ev.freightPerUnit}`);
  check("freightFree: net equals base net", near(ev.freightNet, ev.baseNet), `got ${ev.freightNet}`);
  check("freightFree: reason states the threshold model",
    hasReason(ev, "$0/unit") && hasReason(ev, "at/above the $800 free-freight threshold"),
    ev.reasons.join(" | "));
  check("freightFree: still candidate", ev.verdict === "candidate", ev.verdict);
}

// --- custom freight rate -----------------------------------------------------
{
  const ev = evaluateOffer(BATTERY, STRONG_SIGNALS, { freightRatePct: 0.2 });
  check("freightRate: 20% applied", near(ev.freightPerUnit, 0.9), `got ${ev.freightPerUnit}`);
  check("freightRate: net reduced accordingly", near(ev.freightNet, 8.62), `got ${ev.freightNet}`);
  check("freightRate: reason states 20%", hasReason(ev, "20% of supplier cost"), ev.reasons.join(" | "));
}

// --- gated candidate: APPROVAL_REQUIRED does NOT block -----------------------
{
  const ev = evaluateOffer(BATTERY, { ...STRONG_SIGNALS, eligibility: "APPROVAL_REQUIRED" });
  check("gated: still candidate", ev.verdict === "candidate", ev.verdict);
  check("gated: invoice reason present",
    ev.reasons.includes("gated: needs approval — invoice from this order qualifies"),
    ev.reasons.join(" | "));
}

// --- BLOCKED eligibility forces pass ----------------------------------------
{
  const ev = evaluateOffer(BATTERY, { ...STRONG_SIGNALS, eligibility: "BLOCKED" });
  check("blocked: verdict pass despite strong economics", ev.verdict === "pass", ev.verdict);
  check("blocked: score capped at 10", ev.score <= 10, `got ${ev.score}`);
  check("blocked: reason present", hasReason(ev, "eligibility: blocked"), ev.reasons.join(" | "));
}

// --- weak velocity → watch ----------------------------------------------------
{
  const ev = evaluateOffer(BATTERY, { ...STRONG_SIGNALS, bsr: 400000 });
  check("weak velocity: class", ev.velocityClass === "weak", ev.velocityClass);
  check("weak velocity: verdict watch (still profitable)", ev.verdict === "watch", ev.verdict);
  check("weak velocity: watch reason", hasReason(ev, "watch: velocity is weak"), ev.reasons.join(" | "));
}

// --- unknown velocity + unknown stock (Frontier shape) → candidate -----------
{
  const ev = evaluateOffer(
    { ...BATTERY, supplier: "frontier" },
    { amazonPrice: 24.95, bsr: null, category: null, eligibility: "ELIGIBLE", stockAtSupplier: null }
  );
  check("unknown velocity: class", ev.velocityClass === "unknown", ev.velocityClass);
  check("unknown signals: candidate still allowed", ev.verdict === "candidate", ev.verdict);
  check("unknown stock: reason present", hasReason(ev, "supplier stock: unknown"), ev.reasons.join(" | "));
  check("unknown velocity: reason present", hasReason(ev, "velocity: unknown"), ev.reasons.join(" | "));
}

// --- thin economics → watch with both bar explanations ------------------------
// Brentwood-style row: base net $5.72, freight $1.60 → $4.12 / 10.4%.
{
  const ev = evaluateOffer(
    { supplier: "petra", title: "Brentwood 5in Flip Belgian Waffle Maker Silver", productClass: null, subcategory: null, costPrice: 19.99 },
    { amazonPrice: 39.54, bsr: 5000, category: null, eligibility: "ELIGIBLE", stockAtSupplier: 32 }
  );
  check("thin: verdict watch", ev.verdict === "watch", ev.verdict);
  check("thin: net below bar reason", hasReason(ev, `below the $${CANDIDATE_MIN_NET} candidate bar`), ev.reasons.join(" | "));
  check("thin: margin below bar reason", hasReason(ev, `below the ${CANDIDATE_MIN_MARGIN_PCT}% candidate bar`), ev.reasons.join(" | "));
}

// --- unprofitable → pass -------------------------------------------------------
{
  const ev = evaluateOffer(
    { supplier: "petra", title: "Brentwood 8 Cup Food Processor Green", productClass: null, subcategory: null, costPrice: 14.99 },
    { amazonPrice: 24.18, bsr: 5000, category: null, eligibility: "ELIGIBLE", stockAtSupplier: 13 }
  );
  check("loser: verdict pass", ev.verdict === "pass", ev.verdict);
  check("loser: negative freight net", ev.freightNet < 0, `got ${ev.freightNet}`);
  check("loser: reason present", hasReason(ev, "pass: not profitable after freight"), ev.reasons.join(" | "));
}

// --- out of stock → watch ------------------------------------------------------
{
  const ev = evaluateOffer(BATTERY, { ...STRONG_SIGNALS, stockAtSupplier: 0 });
  check("oos: verdict watch", ev.verdict === "watch", ev.verdict);
  check("oos: reasons present",
    hasReason(ev, "supplier stock: out of stock") && hasReason(ev, "watch: supplier is out of stock"),
    ev.reasons.join(" | "));
}

// --- seasonal boost: exactly +10, group named, non-seasonal untouched ---------
{
  const baseOffer = {
    supplier: "petra",
    title: "Ceramic Mixing Bowl Set of 3",
    productClass: null,
    subcategory: null,
    costPrice: 10,
  };
  const signals = {
    amazonPrice: 30,
    bsr: 30000,
    category: null,
    eligibility: "ELIGIBLE",
    stockAtSupplier: 12,
  };
  const plain = evaluateOffer(baseOffer, signals);
  const seasonal = evaluateOffer(
    { ...baseOffer, title: "Belgian Waffle Maker with Removable Plates" },
    signals
  );
  check("seasonal: plain offer has no groups", plain.seasonalGroups.length === 0, plain.seasonalGroups.join(","));
  check("seasonal: no seasonal reasons on plain offer",
    !plain.reasons.some((r) => r.startsWith("seasonal:")), plain.reasons.join(" | "));
  check("seasonal: group matched",
    seasonal.seasonalGroups.includes("kitchen small appliances"), seasonal.seasonalGroups.join(","));
  check("seasonal: reason string shape",
    seasonal.reasons.includes("seasonal: kitchen small appliances"), seasonal.reasons.join(" | "));
  check("seasonal: score bump is exactly +10",
    seasonal.score - plain.score === 10, `${plain.score} -> ${seasonal.score}`);
  check("seasonal: same economics otherwise",
    near(seasonal.freightNet, plain.freightNet) && seasonal.verdict === plain.verdict,
    `${seasonal.freightNet} vs ${plain.freightNet}`);
}

// --- seasonal group table ------------------------------------------------------
{
  check("seasonal groups: diffuser → home fragrance",
    seasonalGroupsFor({ title: "Aura Cacia Essential Oil Diffuser Kit" }).includes("home fragrance & diffusers"));
  check("seasonal groups: batteries → batteries",
    seasonalGroupsFor({ title: "Alkaline AA Batteries 48 Pack" }).includes("batteries"));
  check("seasonal groups: subcategory participates",
    seasonalGroupsFor({ title: "Generic Widget", subcategory: "Board Game" }).includes("toys & games"));
  check("seasonal groups: plain cable → none",
    seasonalGroupsFor({ title: "Braided USB Cable 6ft" }).length === 0);
  check("seasonal groups: empty offer → none",
    seasonalGroupsFor({ title: null, subcategory: null, productClass: null }).length === 0);
}

// --- velocity classification boundaries ---------------------------------------
{
  check("velocity: toys BSR 1000 strong", classifyVelocity(1000, "toys").cls === "strong");
  check("velocity: BSR 400k weak", classifyVelocity(400000, null).cls === "weak");
  check("velocity: null BSR unknown", classifyVelocity(null, "toys").cls === "unknown");
  check("velocity: zero BSR unknown", classifyVelocity(0, null).monthlySales === null);
  const steady = classifyVelocity(30000, null);
  check("velocity: BSR 30k steady", steady.cls === "steady", `${steady.cls} (${steady.monthlySales}/mo)`);
}

// --- unusable price → pass, score 0 --------------------------------------------
{
  const ev = evaluateOffer(BATTERY, { ...STRONG_SIGNALS, amazonPrice: 0 });
  check("no price: verdict pass", ev.verdict === "pass", ev.verdict);
  check("no price: score 0", ev.score === 0, `got ${ev.score}`);
  check("no price: reason present", hasReason(ev, "no usable Amazon price"), ev.reasons.join(" | "));
}

// --- score always within 0..100 --------------------------------------------------
{
  const cases = [
    evaluateOffer(BATTERY, STRONG_SIGNALS),
    evaluateOffer(BATTERY, { ...STRONG_SIGNALS, eligibility: "BLOCKED" }),
    evaluateOffer(BATTERY, { ...STRONG_SIGNALS, bsr: 400000, stockAtSupplier: 0 }),
    evaluateOffer(BATTERY, { ...STRONG_SIGNALS, amazonPrice: 0 }),
  ];
  check("score: all within 0..100", cases.every((c) => c.score >= 0 && c.score <= 100),
    cases.map((c) => c.score).join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
