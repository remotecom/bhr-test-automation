/**
 * Step 1: GET /v1/countries
 * Fetches available countries and their supported products.
 *
 * Products in the API: "standard" (CM), "plus" (CM+), "cor" (COR)
 */

import type { RemoteClient } from "../client";

export interface Country {
  code: string;
  name: string;
  region: string;
  subregion: string;
  alpha_2_code: string;
  eor_onboarding: boolean;
  contractor_products_available: string[];
  supported_json_schemas: string[];
  country_subdivisions: Array<{ code: string; name: string; subdivision_type: string }>;
  [key: string]: unknown;
}

interface CountriesResponse {
  data: Country[];
}

/** Fetch all countries from the partner API */
export async function getCountries(client: RemoteClient): Promise<Country[]> {
  const { status, data } = await client.get<CountriesResponse>("/v1/countries");
  if (status !== 200) {
    throw new Error(`GET /v1/countries failed with status ${status}`);
  }
  return data.data;
}

/** Find a specific country by ISO 3166-1 alpha-3 code */
export function findCountry(countries: Country[], code: string): Country | undefined {
  return countries.find(
    (c) => c.code?.toLowerCase() === code.toLowerCase()
  );
}

/** Get available contractor products for a country */
export function getCountryProducts(country: Country): string[] {
  return country.contractor_products_available || [];
}
