/**
 * National phone-number formats for the sample provider (pure). Every generated number is valid for
 * libphonenumber-js (verified in tests for all countries). Numbers are random within real national
 * ranges; the data is labelled as sample data everywhere it is shown.
 */
import type { Rng } from "./prng";

export type SamplePhone = {
  /** As a provider lists it nationally, e.g. "90 12 34 56" (Togo) or "024 123 4567" (Ghana). */
  national: string;
  /** "+228 90 12 34 56". */
  international: string;
  /** E.164 without "+", e.g. "22890123456". */
  e164Digits: string;
  mobile: boolean;
};

type Range = {
  /** National significant number prefixes; one is chosen uniformly. */
  prefixes: readonly string[];
  /** Grouping of the national significant number for display, e.g. [2, 2, 2, 2]. */
  groups: readonly number[];
};

type PhonePlan = {
  callingCode: string;
  nsnLength: number;
  /** National trunk prefix shown in national format ("0" in Ghana, France…). */
  trunk: string;
  mobileShare: number;
  mobile: Range;
  fixed: Range;
  /** City-specific landline prefixes (by sample city id). */
  fixedByCity?: Record<string, readonly string[]>;
  /** North American style: (212) 555-0123. */
  nanp?: boolean;
};

const PLANS: Record<string, PhonePlan> = {
  TG: {
    callingCode: "228", nsnLength: 8, trunk: "", mobileShare: 0.85,
    mobile: { prefixes: ["70", "71", "72", "79", "90", "91", "92", "93", "96", "97", "98", "99"], groups: [2, 2, 2, 2] },
    fixed: { prefixes: ["222", "225", "226"], groups: [2, 2, 2, 2] },
    fixedByCity: { lome: ["222", "225", "226", "227"], kara: ["266"], sokode: ["255"], kpalime: ["244"] },
  },
  GH: {
    callingCode: "233", nsnLength: 9, trunk: "0", mobileShare: 0.85,
    mobile: { prefixes: ["20", "23", "24", "25", "26", "27", "28", "50", "53", "54", "55", "56", "57", "59"], groups: [2, 3, 4] },
    fixed: { prefixes: ["302", "303"], groups: [2, 3, 4] },
    fixedByCity: { accra: ["302", "303"], kumasi: ["322"], tamale: ["372"], takoradi: ["312"] },
  },
  BJ: {
    callingCode: "229", nsnLength: 10, trunk: "", mobileShare: 0.88,
    mobile: { prefixes: ["0190", "0191", "0194", "0195", "0196", "0197", "0161", "0162", "0166", "0167", "0151", "0152"], groups: [2, 2, 2, 2, 2] },
    fixed: { prefixes: ["012130", "012131", "012133"], groups: [2, 2, 2, 2, 2] },
    fixedByCity: { cotonou: ["012130", "012131", "012133"], "porto-novo": ["012021", "012022"] },
  },
  CI: {
    callingCode: "225", nsnLength: 10, trunk: "", mobileShare: 1,
    mobile: { prefixes: ["0707", "0708", "0709", "0748", "0749", "0757", "0758", "0505", "0506", "0554", "0555", "0556", "0101", "0102", "0103", "0140", "0141"], groups: [2, 2, 2, 4] },
    fixed: { prefixes: ["0707"], groups: [2, 2, 2, 4] },
  },
  NG: {
    callingCode: "234", nsnLength: 10, trunk: "0", mobileShare: 1,
    mobile: {
      prefixes: ["803", "806", "813", "816", "703", "706", "810", "814", "903", "906", "802", "808", "812", "701", "708", "902", "805", "807", "815", "905", "809", "817", "818", "909"],
      groups: [3, 3, 4],
    },
    fixed: { prefixes: ["803"], groups: [3, 3, 4] },
  },
  SN: {
    callingCode: "221", nsnLength: 9, trunk: "", mobileShare: 0.85,
    mobile: { prefixes: ["77", "78", "76", "70", "75"], groups: [2, 3, 2, 2] },
    fixed: { prefixes: ["3382", "3386", "3384"], groups: [2, 3, 2, 2] },
  },
  BF: {
    callingCode: "226", nsnLength: 8, trunk: "", mobileShare: 0.85,
    mobile: { prefixes: ["70", "71", "72", "76", "78", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "73", "74", "75", "77"], groups: [2, 2, 2, 2] },
    fixed: { prefixes: ["2530", "2531", "2533", "2536"], groups: [2, 2, 2, 2] },
  },
  ML: {
    callingCode: "223", nsnLength: 8, trunk: "", mobileShare: 0.85,
    mobile: { prefixes: ["66", "76", "70", "79", "65", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "75", "77", "78"], groups: [2, 2, 2, 2] },
    fixed: { prefixes: ["2022", "2021", "2023", "2029"], groups: [2, 2, 2, 2] },
  },
  NE: {
    callingCode: "227", nsnLength: 8, trunk: "", mobileShare: 0.85,
    mobile: { prefixes: ["90", "91", "92", "93", "94", "96", "97", "98", "99", "88", "89", "80", "81"], groups: [2, 2, 2, 2] },
    fixed: { prefixes: ["2072", "2073", "2075"], groups: [2, 2, 2, 2] },
  },
  CM: {
    callingCode: "237", nsnLength: 9, trunk: "", mobileShare: 0.85,
    mobile: {
      prefixes: ["650", "651", "652", "653", "654", "670", "671", "672", "673", "674", "675", "676", "677", "678", "679", "680", "681", "690", "691", "694", "695", "696", "697", "698", "699"],
      groups: [1, 2, 2, 2, 2],
    },
    fixed: { prefixes: ["2334", "2333", "2222"], groups: [1, 2, 2, 2, 2] },
    fixedByCity: { douala: ["2334", "2333", "2337"], yaounde: ["2222", "2223", "2221"] },
  },
  KE: {
    callingCode: "254", nsnLength: 9, trunk: "0", mobileShare: 0.9,
    mobile: { prefixes: ["70", "71", "72", "74", "79", "110", "111", "112", "113", "114", "115"], groups: [3, 6] },
    fixed: { prefixes: ["202", "203", "204"], groups: [2, 7] },
  },
  FR: {
    callingCode: "33", nsnLength: 9, trunk: "0", mobileShare: 0.3,
    mobile: { prefixes: ["61", "62", "63", "64", "65", "66", "67", "68", "75", "76", "77", "78"], groups: [1, 2, 2, 2, 2] },
    fixed: { prefixes: ["142", "143", "144", "145", "147", "148", "153", "155"], groups: [1, 2, 2, 2, 2] },
    fixedByCity: { paris: ["142", "143", "144", "145", "147", "148", "153", "155"], lyon: ["472", "478"] },
  },
  GB: {
    callingCode: "44", nsnLength: 10, trunk: "0", mobileShare: 0.3,
    mobile: { prefixes: ["74", "75", "77", "78", "79"], groups: [4, 6] },
    fixed: { prefixes: ["207", "203", "208"], groups: [2, 4, 4] },
  },
  US: {
    callingCode: "1", nsnLength: 10, trunk: "", mobileShare: 0.4, nanp: true,
    mobile: { prefixes: ["917", "347", "929"], groups: [3, 3, 4] },
    fixed: { prefixes: ["212", "646", "718"], groups: [3, 3, 4] },
  },
  CA: {
    callingCode: "1", nsnLength: 10, trunk: "", mobileShare: 0.4, nanp: true,
    mobile: { prefixes: ["647", "437"], groups: [3, 3, 4] },
    fixed: { prefixes: ["416"], groups: [3, 3, 4] },
  },
};

export const PHONE_COUNTRIES = Object.keys(PLANS);

function group(nsn: string, groups: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= nsn.length) break;
    parts.push(nsn.slice(i, i + g));
    i += g;
  }
  if (i < nsn.length) parts.push(nsn.slice(i));
  return parts.join(" ");
}

/** NANP exchange codes: [2-9]XX, excluding N11 service codes and 555. */
function nanpExchange(rng: Rng): string {
  for (;;) {
    const ex = `${rng.int(2, 9)}${rng.int(0, 9)}${rng.int(0, 9)}`;
    if (ex[1] === "1" && ex[2] === "1") continue;
    if (ex === "555" || ex === "950" || ex === "958" || ex === "959" || ex === "976") continue;
    return ex;
  }
}

/** A random valid phone number for the country (ISO alpha-2), or null for an unsupported country. */
export function samplePhone(rng: Rng, countryCode: string, cityId?: string): SamplePhone | null {
  const plan = PLANS[countryCode];
  if (!plan) return null;
  const mobile = rng.chance(plan.mobileShare);
  const range = mobile ? plan.mobile : plan.fixed;
  const prefixes = !mobile && cityId && plan.fixedByCity?.[cityId] ? plan.fixedByCity[cityId]! : range.prefixes;
  const prefix = rng.pick(prefixes);

  if (plan.nanp) {
    const nsn = `${prefix}${nanpExchange(rng)}${rng.digits(4)}`;
    return {
      national: `(${nsn.slice(0, 3)}) ${nsn.slice(3, 6)}-${nsn.slice(6)}`,
      international: `+1 ${nsn.slice(0, 3)}-${nsn.slice(3, 6)}-${nsn.slice(6)}`,
      e164Digits: `1${nsn}`,
      mobile,
    };
  }
  // Avoid a leading 0 right after the prefix for countries whose ranges reject it (keeps numbers plausible).
  let nsn = prefix + rng.digits(plan.nsnLength - prefix.length);
  if (countryCode === "GB" && mobile) nsn = prefix + String(rng.int(1, 9)) + rng.digits(plan.nsnLength - prefix.length - 1);
  const grouped = group(nsn, range.groups);
  return {
    national: plan.trunk ? `${plan.trunk}${grouped}` : grouped,
    international: `+${plan.callingCode} ${grouped}`,
    e164Digits: `${plan.callingCode}${nsn}`,
    mobile,
  };
}
