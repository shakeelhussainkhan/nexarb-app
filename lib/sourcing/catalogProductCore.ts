// Catalog Items -> product display info mapper.
//
// The deals UI showed bare ASINs because nothing persisted what a
// product actually is. SP-API Catalog Items responses (search by UPC,
// keyword search, getItem) all carry the display facts in the same
// shape — summaries[0].itemName / .brand / .manufacturer and the images
// tree — so one pure mapper serves every caller:
//
//   lib/sourcing/match.ts  (ingest-time matches + getItem backfill)
//   lib/engine/productBackfill.ts (lazy watchlist backfill)
//
// Pure logic only (no network, no secrets) so the offline harness can
// exercise every rule. Never throws; malformed input maps to nulls.

export interface CatalogProductInfo {
  title: string | null;
  brand: string | null;
  imageUrl: string | null;
}

interface CatalogItemRaw {
  asin?: unknown;
  summaries?: unknown;
  images?: unknown;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * Pick the display image from a Catalog Items `images` array:
 * [{ marketplaceId, images: [{ variant, link, width, height }] }].
 * Prefers the MAIN variant (widest when several), otherwise the widest
 * image available. Null when no usable link exists.
 */
export function pickCatalogImageUrl(images: unknown): string | null {
  try {
    if (!Array.isArray(images)) return null;
    let bestMain: { link: string; width: number } | null = null;
    let bestAny: { link: string; width: number } | null = null;
    for (const group of images) {
      const list = (group as { images?: unknown } | null)?.images;
      if (!Array.isArray(list)) continue;
      for (const img of list) {
        const rec = img as { variant?: unknown; link?: unknown; width?: unknown } | null;
        const link = cleanString(rec?.link);
        if (!link || !link.startsWith("http")) continue;
        const width = typeof rec?.width === "number" ? rec.width : 0;
        if (!bestAny || width > bestAny.width) bestAny = { link, width };
        if (rec?.variant === "MAIN" && (!bestMain || width > bestMain.width)) {
          bestMain = { link, width };
        }
      }
    }
    return (bestMain ?? bestAny)?.link ?? null;
  } catch {
    return null;
  }
}

/**
 * Map ONE Catalog Items item (from a search response's items[] or a
 * getItem response body) to display info. Returns null when the item
 * carries no usable fact at all (no title, no brand, no image).
 */
export function mapCatalogItem(item: unknown): CatalogProductInfo | null {
  try {
    const raw = item as CatalogItemRaw | null;
    if (!raw || typeof raw !== "object") return null;
    const summaries = Array.isArray(raw.summaries) ? raw.summaries : [];
    const s = (summaries[0] ?? {}) as {
      itemName?: unknown;
      brand?: unknown;
      manufacturer?: unknown;
    };
    const title = cleanString(s.itemName);
    const brand = cleanString(s.brand) ?? cleanString(s.manufacturer);
    const imageUrl = pickCatalogImageUrl(raw.images);
    if (!title && !brand && !imageUrl) return null;
    return { title, brand, imageUrl };
  } catch {
    return null;
  }
}

/**
 * Map the first item carrying an ASIN out of a Catalog Items search
 * response ({ items: [...] }) to { asin, ...display info }. Null when
 * no item carries an ASIN or the payload is malformed.
 */
export function mapFirstCatalogItem(
  payload: unknown
): (CatalogProductInfo & { asin: string }) | null {
  try {
    const items = (payload as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return null;
    for (const raw of items) {
      const asin = cleanString((raw as CatalogItemRaw | null)?.asin);
      if (!asin) continue;
      const info = mapCatalogItem(raw);
      return {
        asin,
        title: info?.title ?? null,
        brand: info?.brand ?? null,
        imageUrl: info?.imageUrl ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}
