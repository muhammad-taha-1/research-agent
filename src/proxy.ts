import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: verifies the signed session cookie, never hits the DB.
// Pages and route handlers still check the session themselves (src/lib/auth.ts).
export async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname, search } = req.nextUrl;

  if (pathname === "/login") {
    return token ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }

  if (token) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except NextAuth's own routes, the worker health check, and static assets.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
