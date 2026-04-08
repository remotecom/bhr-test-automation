export interface TestExpected {
  eligibility?: { standard: boolean; plus: boolean; cor: boolean };
  country?: string[] | null;
  subs?: string[] | null;
  questionnaire?: { isBlocking: boolean } | null;
  note?: string;
}

export interface TestCase {
  section?: string;
  id?: string;
  desc?: string;
  entity?: string;
  hire?: string;
  path?: string;
  ir35?: string;
  expected?: TestExpected;
}

export const TEST_MATRIX: TestCase[] = [
  { section: "CM Path — Round 1 (UK Entity)" },
  {
    id: "A1(CM)",
    desc: "Happy path — standard product available for PRT contractor",
    entity: "GBR",
    hire: "PRT",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: null,
    },
  },
  {
    id: "B2",
    desc: "Country with no COR support (BHR) — CM+CM+ on pricing, COR absent",
    entity: "GBR",
    hire: "BHR",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus"],
      subs: ["CM", "CM+"],
      questionnaire: null,
    },
  },
  {
    id: "B6",
    desc: "Same-country (GBR) — COR absent, standard/plus shown",
    entity: "GBR",
    hire: "GBR",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+"],
      questionnaire: null,
    },
  },
  {
    id: "D4",
    desc: "UK contractor — IR35 inside — standard survives",
    entity: "GBR",
    hire: "GBR",
    path: "CM",
    ir35: "inside",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus", "cor"],
      subs: ["CM"],
      questionnaire: null,
    },
  },

  { section: "CM Path — Round 2 (USA Entity)" },
  {
    id: "D2",
    desc: "UK contractor — IR35 inside — only standard remains",
    entity: "USA",
    hire: "GBR",
    path: "CM",
    ir35: "inside",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM"],
      questionnaire: null,
    },
  },
  {
    id: "D3",
    desc: "UK contractor — IR35 inside — only CM remains",
    entity: "USA",
    hire: "GBR",
    path: "CM",
    ir35: "inside",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM"],
      questionnaire: null,
    },
  },

  { section: "Nationality Path — Round 1 (UK Entity)" },
  {
    id: "N1",
    desc: "BHR contractor — nationality national — CM + CM+ available",
    entity: "GBR",
    hire: "BHR",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus"],
      subs: ["CM", "CM+"],
      questionnaire: null,
    },
  },
  {
    id: "N2",
    desc: "BHR contractor — nationality non_national — only CM (CM+ blocked)",
    entity: "GBR",
    hire: "BHR",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus"],
      subs: ["CM"],
      questionnaire: null,
    },
  },

  { section: "CM+ Path — Round 1 (UK Entity)" },
  {
    id: "A1(CM+)",
    desc: "Happy path — plus product available for PRT contractor",
    entity: "GBR",
    hire: "PRT",
    path: "CM+",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: null,
    },
  },

  { section: "COR+IR35 Path — Round 2 (USA Entity)" },
  {
    id: "D1",
    desc: "UK contractor — IR35 outside — all 3 products, COR selected",
    entity: "USA",
    hire: "GBR",
    path: "COR+IR35",
    ir35: "outside",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: { isBlocking: false },
    },
  },
  {
    id: "D5",
    desc: "UK contractor — IR35 exempt — all 3 products available",
    entity: "USA",
    hire: "GBR",
    path: "COR+IR35",
    ir35: "exempt",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: { isBlocking: false },
    },
  },
  {
    id: "D6",
    desc: "UK contractor — IR35 outside — SDS upload, products avail",
    entity: "USA",
    hire: "GBR",
    path: "COR+IR35",
    ir35: "outside",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: { isBlocking: false },
    },
  },

  { section: "COR Path — Round 1 (UK Entity)" },
  {
    id: "A1(COR)",
    desc: "Happy path — COR available, flow completes for PRT",
    entity: "GBR",
    hire: "PRT",
    path: "COR",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: { isBlocking: false },
    },
  },
  {
    id: "G1",
    desc: "COR questionnaire — passes with non-blocking answers",
    entity: "GBR",
    hire: "PRT",
    path: "COR",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: { isBlocking: false },
    },
  },

  { section: "COR Path — Round 2 (USA Entity)" },
  {
    id: "B5",
    desc: "Same-country COR (USA) — COR absent (API scope: engaged_by=bill_to=default LE)",
    entity: "USA",
    hire: "USA",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+"],
      questionnaire: null,
    },
  },

  { section: "COR Path — Round 3 (Germany Entity)" },
  {
    id: "B4",
    desc: "Same-country COR (DEU) — COR absent (API scope: engaged_by=bill_to=default LE)",
    entity: "DEU",
    hire: "DEU",
    path: "CM",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+"],
      questionnaire: null,
    },
  },

  { section: "EOR Fallback — Round 4 (India Entity)" },
  {
    id: "B3",
    desc: "India entity + India contractor — no products, EOR fallback",
    entity: "IND",
    hire: "IND",
    path: "EOR",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: false },
      country: ["standard", "plus", "cor"],
      subs: [],
      questionnaire: null,
    },
  },
  {
    id: "F1",
    desc: "India entity + PRT contractor — only COR (30-country rule)",
    entity: "IND",
    hire: "PRT",
    path: "EOR",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["COR"],
      questionnaire: null,
    },
  },

  { section: "EOR Fallback — Round 2 (USA Entity)" },
  {
    id: "G2",
    desc: "COR blocked by questionnaire — blocking answers",
    entity: "USA",
    hire: "PRT",
    path: "EOR",
    ir35: "",
    expected: {
      eligibility: { standard: true, plus: true, cor: true },
      country: ["standard", "plus", "cor"],
      subs: ["CM", "CM+", "COR"],
      questionnaire: { isBlocking: true },
    },
  },

  { section: "Read-Only" },
  {
    id: "B1",
    desc: "Sanctioned countries absent from country list",
    entity: "GBR",
    hire: "—",
    path: "Read-only",
    ir35: "",
    expected: {
      country: null,
      subs: null,
      questionnaire: null,
      note: "IRN,CUB,PRK,SYR absent",
    },
  },
  {
    id: "B8",
    desc: "Country with no CSA template — not visible or no products",
    entity: "GBR",
    hire: "—",
    path: "Read-only",
    ir35: "",
    expected: {
      country: null,
      subs: null,
      questionnaire: null,
      note: "Countries have fields",
    },
  },
];
