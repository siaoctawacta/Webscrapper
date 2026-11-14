import { describe, expect, it } from "vitest";
import { offsetMeters } from "./geo";
import { findProbableDuplicates, type DuplicateCandidate } from "./index";

const LOME = { lat: 6.1319, lng: 1.2228 };
let seq = 0;

function rec(overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate {
  seq += 1;
  return { id: `id-${seq}`, name: `Business ${seq}`, phoneE164: null, address: null, websiteHost: null, lat: null, lng: null, ...overrides };
}

const at = (meters: number, bearing = 90) => offsetMeters(LOME, meters, bearing);

describe("findProbableDuplicates", () => {
  it("links records sharing an E.164 phone; the earlier record wins", () => {
    const a = rec({ id: "a", phoneE164: "+22890123456" });
    const b = rec({ id: "b", phoneE164: "+22890123456" });
    const c = rec({ id: "c", phoneE164: "+22890123457" });
    expect(findProbableDuplicates([a, b, c])).toEqual(new Map([["b", "a"]]));
  });

  it("links records sharing a website host but not a shared platform host", () => {
    const a = rec({ id: "a", websiteHost: "palmier.example" });
    const b = rec({ id: "b", websiteHost: "www.palmier.example" });
    const f1 = rec({ id: "f1", websiteHost: "facebook.com" });
    const f2 = rec({ id: "f2", websiteHost: "facebook.com" });
    expect(findProbableDuplicates([a, b, f1, f2])).toEqual(new Map([["b", "a"]]));
  });

  it("links similar names that are less than 80 m apart", () => {
    const a = rec({ id: "a", name: "Hôtel Le Palmier d'Or", ...LOME });
    const b = rec({ id: "b", name: "HOTEL PALMIER D'OR", ...at(30) });
    const c = rec({ id: "c", name: "Palmier d'Or", ...at(150) });
    const d = rec({ id: "d", name: "Hôtel La Lagune", ...at(10, 180) });
    expect(findProbableDuplicates([a, b, c, d])).toEqual(new Map([["b", "a"]]));
  });

  it("does not link similar names without coordinates", () => {
    const a = rec({ id: "a", name: "Pharmacie du Marché" });
    const b = rec({ id: "b", name: "Pharmacie du Marche" });
    expect(findProbableDuplicates([a, b]).size).toBe(0);
  });

  it("maps a whole chain of matches to the earliest record", () => {
    const a = rec({ id: "a", phoneE164: "+233241234567" });
    const b = rec({ id: "b", phoneE164: "+233241234567", websiteHost: "lodge.example" });
    const c = rec({ id: "c", websiteHost: "lodge.example", name: "Golden Palm Lodge", ...LOME });
    const d = rec({ id: "d", name: "Golden Palm", ...at(20) });
    expect(findProbableDuplicates([a, b, c, d])).toEqual(
      new Map([
        ["b", "a"],
        ["c", "a"],
        ["d", "a"],
      ]),
    );
  });

  it("the order of the input decides which record is the original", () => {
    const a = rec({ id: "a", phoneE164: "+22890000000" });
    const b = rec({ id: "b", phoneE164: "+22890000000" });
    expect(findProbableDuplicates([b, a])).toEqual(new Map([["a", "b"]]));
  });

  it("ignores repeated ids and empty input", () => {
    expect(findProbableDuplicates([]).size).toBe(0);
    const a = rec({ id: "same", phoneE164: "+22890000001" });
    expect(findProbableDuplicates([a, { ...a }]).size).toBe(0);
  });

  it("handles 20 000 records in well under 2 seconds", () => {
    const records: DuplicateCandidate[] = [];
    // Dense downtown: 20 000 businesses within ~4 × 4 km, names from a small vocabulary.
    const words = ["Palmier", "Baobab", "Lagune", "Cocotiers", "Flamboyant", "Étoile", "Oasis", "Horizon", "Savane", "Concorde", "Prestige", "Royal"];
    let x = 7;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 20_000; i++) {
      const p = offsetMeters(LOME, rand() * 2000, rand() * 360);
      records.push({
        id: `p${i}`,
        name: `Hôtel ${words[i % words.length]} ${words[Math.floor(rand() * words.length)]} ${i % 97}`,
        phoneE164: i % 50 === 0 ? `+2289${String(i % 1000).padStart(7, "0")}` : `+2289${String(i).padStart(7, "0")}`,
        address: null,
        websiteHost: i % 3 === 0 ? `site-${i % 5000}.example` : null,
        lat: p.lat,
        lng: p.lng,
      });
    }
    const t0 = performance.now();
    const dups = findProbableDuplicates(records);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    expect(dups.size).toBeGreaterThan(0);
    for (const [dup, orig] of dups) {
      expect(Number(orig.slice(1))).toBeLessThan(Number(dup.slice(1)));
      expect(dups.has(orig)).toBe(false);
    }
  });
});
