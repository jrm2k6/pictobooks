/**
 * Local prototype catalog for the customer UI.
 *
 * These entries are intentionally unavailable and priced at zero. They exist
 * only to let local screens render the catalog shape; they are not offers,
 * quotes, or promises about print fulfillment or final pricing.
 */
export interface EditionCatalogItem {
  editionId: string;
  name: string;
  format: "pdf" | "print";
  priceMinor: number;
  shippingPriceMinor?: number;
  available: boolean;
}

export interface EditionCatalogResponse {
  currency: string;
  editions: EditionCatalogItem[];
}

export function listLocalEditions(): EditionCatalogResponse {
  return {
    currency: "USD",
    editions: [
      {
        editionId: "sample-digital-pdf",
        name: "Sample digital PDF (prototype only)",
        format: "pdf",
        priceMinor: 0,
        available: false,
      },
      {
        editionId: "sample-printed-book",
        name: "Sample printed book (prototype only)",
        format: "print",
        priceMinor: 0,
        shippingPriceMinor: 0,
        available: false,
      },
    ],
  };
}
