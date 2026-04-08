import { NextResponse } from "next/server";
import { createClientFromEnv } from "@/src/client";
import { getContractorEligibility } from "@/src/steps/eligibility";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const legalEntityId = searchParams.get("legalEntityId");

  if (!companyId || !legalEntityId) {
    return NextResponse.json(
      { error: "companyId and legalEntityId required" },
      { status: 400 }
    );
  }

  try {
    const client = createClientFromEnv();
    const result = await getContractorEligibility(client, companyId, legalEntityId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Eligibility check failed" },
      { status: 500 }
    );
  }
}
