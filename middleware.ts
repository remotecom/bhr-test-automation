import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET env var is required");
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const publicRoutes = ["/login"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const isPublicRoute = publicRoutes.some((route) => path.startsWith(route));
  const isAuthApi = path.startsWith("/api/auth");

  // Check session
  const sessionCookie = request.cookies.get("session")?.value;
  let isAuthenticated = false;

  if (sessionCookie) {
    try {
      await jwtVerify(sessionCookie, JWT_SECRET);
      isAuthenticated = true;
    } catch {
      // Invalid or expired token
    }
  }

  // API routes get 401 JSON (not redirect) so fetch calls are visible in Network tab
  if (path.startsWith("/api/") && !isAuthApi && !isAuthenticated) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPublicRoute && !isAuthApi && !isAuthenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && isAuthenticated && path === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
