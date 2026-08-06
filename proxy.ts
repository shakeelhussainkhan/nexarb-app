import { NextResponse, type NextRequest } from "next/server";

// When Clerk keys are configured, switch to clerkMiddleware for full auth.
// During development without keys, this passthrough lets pages render.
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redirect root to /login
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)"],
};
