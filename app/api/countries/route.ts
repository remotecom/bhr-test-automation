import { NextResponse } from "next/server";
import { getCachedCountries } from "@/src/dashboard/playground";

export async function GET() {
  try {
    const countries = await getCachedCountries();
    return NextResponse.json({ data: countries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch countries" },
      { status: 500 }
    );
  }
}
