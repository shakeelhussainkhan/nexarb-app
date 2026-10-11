# Authenticity & Source Trust — Founder Guide

NexArb's business model starts at retail (Walmart, Target, Costco, Amazon,
BestBuy, Home Depot, Lowe's). This guide explains why that model is safe,
where the real risks are, and what the app does and doesn't check.

> Not legal advice. Business realities and public Amazon policies as of
> October 2026. When in doubt, talk to a trade attorney.

## 1. Why retail arbitrage is inherently genuine

When you buy a product at retail — Walmart shelf, Target.com, Costco
warehouse — you are buying genuine goods sold through the brand's authorized
supply chain. That is what `assessTrust` flags as `verified-retailer`.

The **first-sale doctrine** (US trademark law) is the reason this is safe:
once a brand owner sells a genuine unit into commerce, they exhaust their
right to control its downstream resale. Reselling a genuine, unaltered
product is not trademark infringement — the unit is authentic *by
definition*, regardless of who re-sells it.

Practical meaning: **the receipt is your proof.** Keep every purchase
receipt (digital or scanned) tied to the ASIN and lot. If Amazon or a brand
ever questions authenticity, the receipt chain is the document that ends the
conversation. NexArb's verified-retailer note exists to remind you of this:
`"Sourced from authorized retail — genuine by definition; keep receipt"`.

## 2. Brand gating (already live-checked)

Genuineness and **eligibility to sell** are two different things. A brand can
be genuine and still gated: Amazon requires approval before you may list
certain brands/ASINs on the marketplace.

NexArb checks this live through Amazon's SP-API Listings Restrictions API —
see `lib/engine/eligibility.ts`. The check runs on every deal evaluation
(`lib/engine/dealcheck.ts`) and returns one of four states:

- **SELLABLE** — no restrictions for your account/ASIN.
- **APPROVAL_REQUIRED** — gated; apply via the approval links surfaced with
  the reason (usually needs an invoice from an authorized source).
- **BLOCKED** — not eligible, no application path (e.g. hard brand gating).
- **UNKNOWN** — API error, no credentials, or unrecognized response.
  Deliberately *never* collapsed into SELLABLE: a false green light strands
  purchased inventory; a false UNKNOWN only costs a re-check.

So the two authenticity questions are answered separately: `trust` (is the
unit genuine?) and `eligibility` (may I list it?).

## 3. Amazon commingling risk + the stickered-inventory (FNSKU) fix

Buying genuine units doesn't fully protect you once inventory is inside
Amazon's fulfillment network:

- **Stickerless, commingled inventory** ("Fulfilled by Amazon" default for
  many ASINs): Amazon pools your units with every other seller's units of
  the same ASIN. If *any* pooled seller sends counterfeits, your buyers can
  receive fakes — and the defect traces back to you.
- **Stickered inventory (Amazon barcode / FNSKU labeling):** each unit
  carries your unique FNSKU label. Amazon tracks your units separately and
  they are **not commingled** with other sellers' stock. Your genuine units
  reach your buyers, and counterfeit units from other sellers cannot be
  attributed to you.

Operational rule: for retail-arbitrage inventory, **ship stickered (FNSKU)**
unless the ASIN's velocity makes the labeling cost uneconomic. This is the
standard fix for the one authenticity risk retail arbitrage actually has,
and it's a fulfillment setting, not a sourcing change.

## 4. Wholesale / Alibaba verification checklist (for later)

NexArb's retail-first model avoids this today, but if you expand into
wholesale or Alibaba, "genuine by first sale" no longer applies — the burden
of proof shifts to you. Minimum checklist before FBA inbound:

1. **Require a supplier invoice** — company letterhead, quantity, date,
   unit price. Amazon's approval flows ask for exactly this.
2. **Verify authorized-distributor status** — check the brand's own
   "where to buy" / authorized-reseller list; an Alibaba storefront is not
   proof of authorization.
3. **Inspect on receipt before FBA inbound** — check packaging, labeling,
   and consistency with a known-genuine unit; quarantine anything off.
4. Keep the invoice chain as durable as receipts: same dispute value.

NexArb flags anything that isn't a known retail domain as `unverified` with
exactly these checklist notes, so the gap is visible on every deal row.

## 5. What NexArb does and doesn't verify

**It does:**

- `lib/engine/trust.ts` (`assessTrust`) — classifies each deal's
  `buy_source` as `verified-retailer` (known retail domains, matched on
  domain boundary — `fake-walmart.com` does *not* verify) or `unverified`,
  with advisory notes. Pure assessment; it never blocks a purchase beyond
  existing guards.
- `lib/engine/eligibility.ts` (`checkEligibility`) — live SP-API brand
  gating check per ASIN, cached 24h for clean results / 3h for restricted.
- The dashboard shows both next to every deal row: a trust badge
  (`✓ Retail` / `⚠ Check source`, notes as tooltip) and the eligibility
  state via the existing channel/confidence display.

**It doesn't:**

- Verify individual receipts, invoices, or physical units — that remains
  your manual step (sections 1 and 4).
- Certify brands, suppliers, or distributors — "unverified" means "not
  retail-first", not "counterfeit".
- Legal or tax advice — the first-sale summary above is a business
  heuristic, not counsel.

Offline coverage: `scripts/verify-ws5-trust.mjs` (29 checks — retail
domains, subdomain and boundary attacks, empty/missing input, notes shape).
