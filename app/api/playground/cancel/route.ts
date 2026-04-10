import { NextResponse } from "next/server";
import { cancelPlaygroundEmployment } from "@/src/dashboard/playground";
import { readRequestOverrides } from "@/src/client";

export async function POST(request: Request) {
  const { employmentId } = await request.json();
  const { gatewayEnv } = readRequestOverrides(request);

  if (!employmentId) {
    return NextResponse.json({ error: "employmentId required" }, { status: 400 });
  }

  try {
    await cancelPlaygroundEmployment(employmentId, () => {}, gatewayEnv);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cancel failed" },
      { status: 500 }
    );
  }
}
