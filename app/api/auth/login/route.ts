import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createSession } from "@/lib/auth";

/** Constant-time comparison (hashing first gives both sides the same length) */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function POST(request: Request) {
  const expected = process.env.AUTH_PASSWORD;

  // Fail closed: without a configured password, nobody can log in
  // (previously `undefined !== undefined` let an empty request through).
  if (!expected) {
    return NextResponse.json(
      { error: "Login is not configured: set AUTH_PASSWORD on the server" },
      { status: 503 }
    );
  }

  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    // Missing or invalid body: treated as a wrong password below
  }

  if (typeof password !== "string" || !safeEqual(password, expected)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await createSession(1, "admin");
  return NextResponse.json({ success: true });
}
