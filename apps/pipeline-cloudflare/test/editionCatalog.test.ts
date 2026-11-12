import { describe, expect, it } from "vitest";
import { listLocalEditions } from "../src/api/editionCatalog";

describe("local edition catalog", () => {
  it("returns the customer API shape with clearly unavailable prototype entries", () => {
    const result = listLocalEditions();

    expect(result.currency).toBe("USD");
    expect(result.editions).toHaveLength(2);
    expect(result.editions.map((edition) => edition.format)).toEqual([
      "pdf",
      "print",
    ]);
    for (const edition of result.editions) {
      expect(edition.name).toContain("prototype only");
      expect(edition.priceMinor).toBe(0);
      expect(edition.available).toBe(false);
    }
  });
});
