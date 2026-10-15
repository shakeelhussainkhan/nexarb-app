import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/login(.*)',
  '/signup(.*)',
  '/forgot-password(.*)',
  '/blog(.*)',
  '/affiliate(.*)',
  '/api/affiliate(.*)',
  '/api/user-chat-ids(.*)',
  '/api/stripe/webhook(.*)',
  '/api/clerk(.*)',
])

// Endpoints that authenticate a personal API key (X-NexArb-Key) in the route
// handler itself — cron automation and the Chrome extension call them with
// no browser session, so the middleware session gate must step aside and let
// the handler validate the key (or the Clerk session) instead of 404ing the
// request at the edge. Every handler under these paths enforces auth:
//   /api/extension/check        — key-only authenticate()
//   /api/sourcing/discover      — resolveUser (key or session)
//   /api/scan/trigger           — resolveUser (key or session)
//   /api/purchases              — GET resolveUser; POST Clerk auth() (create
//                                 stays session-only; the key cannot create)
//   /api/purchases/[id]/checkout — resolveUser; keys limited to status actions
//   /api/approvals              — GET resolveUser; POST session-only (founder
//                                 decisions on the brand-approval queue)
//   /api/sourcing/alibaba       — resolveUser (key or session)
//   /api/alibaba/status         — resolveUser (connection status booleans)
//   /api/alibaba/orders         — GET resolveUser; POST session-only (draft)
//   /api/alibaba/orders/[id]    — GET resolveUser (detail + status sync)
//                                 ([id]/intent and [id]/place are NOT
//                                 bypassed: session-gated here AND in the
//                                 handlers, like purchases/[id]/approve)
//   /api/compliance/screen      — resolveUser (pure screening computation)
//   /api/compliance/overview    — resolveUser (read-only summary)
//   /api/compliance/shipments   — GET resolveUser; POST session-only
//   /api/compliance/shipments/[id]/package — resolveUser (read-only)
//   /api/compliance/alerts/run  — resolveUser (daily monitor evaluates and
//                                 sends Telegram compliance alerts)
//   /api/sourcing/petra         — resolveUser (key or session; supplier
//                                 catalog ingest — data only, no ordering)
//   /api/sourcing/petra/match   — resolveUser (bounded UPC→ASIN match pass)
//   /api/sourcing/petra/scan    — resolveUser (bounded pricing/estimate pass)
//   /api/sourcing/frontier      — resolveUser (key or session; supplier
//                                 catalog ingest — data only, no ordering)
//   /api/sourcing/frontier/match — resolveUser (bounded UPC→ASIN match pass)
//   /api/sourcing/frontier/scan — resolveUser (bounded pricing/estimate pass)
//   /api/sourcing/evaluate      — resolveUser (bounded verdict pass over
//                                 matched + priced supplier offers)
//   /api/suppliers              — GET resolveUser (supplier offers read)
//   /api/finances/sync          — resolveUser (key or session; Money
//                                 module ingestion — bounded SP-API
//                                 Orders/Finances sync, data only)
//   /api/orders/journeys        — GET resolveUser (read-only unified
//                                 order-lifecycle view, PR-D1).
//                                 /api/orders/external is NOT bypassed:
//                                 registering an external order stays
//                                 session-only, enforced in its handler.
// NOT included: /api/suppliers/promote (session-only founder decision,
// enforced in the handler like /api/approvals POST),
// /api/purchases/[id]/approve (approvals stay session-gated here AND in
// the handler) and every other API route — several rely on this
// middleware as their only auth, so the bypass must stay path-exact. Plain
// regexes (not createRouteMatcher) so the dynamic-segment matching does not
// depend on Clerk's pattern-syntax version.
const API_KEY_PATH_RES: RegExp[] = [
  /^\/api\/extension\/check(\/.*)?$/,
  /^\/api\/sourcing\/discover(\/.*)?$/,
  /^\/api\/sourcing\/alibaba$/,
  /^\/api\/scan\/trigger(\/.*)?$/,
  /^\/api\/purchases$/,
  /^\/api\/purchases\/[^/]+\/checkout(\/.*)?$/,
  /^\/api\/approvals$/,
  /^\/api\/alibaba\/status$/,
  /^\/api\/alibaba\/orders$/,
  /^\/api\/alibaba\/orders\/[^/]+$/,
  /^\/api\/compliance\/screen$/,
  /^\/api\/compliance\/overview$/,
  /^\/api\/compliance\/shipments$/,
  /^\/api\/compliance\/shipments\/[^/]+\/package$/,
  /^\/api\/compliance\/alerts\/run$/,
  /^\/api\/sourcing\/petra$/,
  /^\/api\/sourcing\/petra\/match$/,
  /^\/api\/sourcing\/petra\/scan$/,
  /^\/api\/sourcing\/frontier$/,
  /^\/api\/sourcing\/frontier\/match$/,
  /^\/api\/sourcing\/frontier\/scan$/,
  /^\/api\/sourcing\/evaluate$/,
  /^\/api\/suppliers$/,
  /^\/api\/finances\/sync$/,
  /^\/api\/orders\/journeys$/,
]

export default clerkMiddleware(async (auth, request) => {
  if (API_KEY_PATH_RES.some((re) => re.test(request.nextUrl.pathname))) {
    return
  }
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov)).*)',
    '/(api|trpc)(.*)',
  ],
}

