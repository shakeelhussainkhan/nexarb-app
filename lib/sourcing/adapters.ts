// Retailer adapter registry for deal discovery.
//
// Walmart clearance is the first source adapter; Target, Costco, and other
// leading stores register here when built. The sweep route can iterate this
// registry to sweep every retailer in one run (currently it sweeps Walmart
// directly — switching to registry iteration is the multi-retailer PR).

import type { RetailerAdapter } from "./types";
import { walmartAdapter } from "./walmart";

export const retailerAdapters: RetailerAdapter[] = [walmartAdapter];

export function getAdapter(slug: string): RetailerAdapter | undefined {
  return retailerAdapters.find((a) => a.slug === slug);
}
