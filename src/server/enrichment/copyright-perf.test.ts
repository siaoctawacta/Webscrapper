import { describe, expect, it } from "vitest";
import { findCopyrightYear } from "./extract";

describe("findCopyrightYear on hostile input", () => {
  it("stays fast on a 1.5 MB single line full of © markers", () => {
    const text = "© ".repeat(750_000) + "© 2019";
    const t0 = performance.now();
    findCopyrightYear(text, 2026);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("still finds the latest year on normal pages", () => {
    expect(findCopyrightYear("Home\nAbout us\n© 2015–2018 Hôtel Le Bénin. All rights reserved.", 2026)).toBe(2018);
    expect(findCopyrightYear("Copyright 2021\nfoo (c) 2023", 2026)).toBe(2023);
    expect(findCopyrightYear("© 2031 future", 2026)).toBeNull();
  });
});
