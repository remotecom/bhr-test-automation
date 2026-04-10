import { NextResponse } from "next/server";
import { getCachedCountries } from "@/src/dashboard/playground";
import { readRequestOverrides } from "@/src/client";

export async function GET(request: Request) {
  try {
    const { gatewayEnv } = readRequestOverrides(request);
    const countries = await getCachedCountries(gatewayEnv);
    return NextResponse.json({ data: countries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch countries" },
      { status: 500 }
    );
  }
}
