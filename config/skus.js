// Edit this list with the SKUs you want open to ambassador applications.
// variantId = the Shopify numeric variant ID (Admin API > Products > variant > copy ID from URL,
// or GET /admin/api/2024-10/products/{id}/variants.json)
export const AMBASSADOR_SKUS = [
  {
    sku: "NP-VANILLA-CREAM-SQ",
    title: "Vanilla Cream Square Nails",
    variantId: "44760505352226",
  },
  {
    sku: "NP-CLASSIC-WHITE-FRENCH-SQ",
    title: "Classic White French Nails",
    variantId: "44760501944354",
  },
];

// SKUs that are no longer offered to new applicants (hidden from /api/skus),
// but kept here so anyone who already applied can still sign their contract
// and get their order placed. Without these, signing would fail to find the
// product and no order would be created.
const RETIRED_SKUS = [
  {
    sku: "NP-PEARL-PRISM-SQ",
    title: "Pearl Prism Square Nails",
    variantId: "46469104500770",
  },
  {
    sku: "NP-WHITE-FRENCH-ALM",
    title: "White French Almond Nails",
    variantId: "43778707587106",
  },
  {
    sku: "NP-MIRROR-GLAZE-ALM",
    title: "Mirror Glaze Almond Nails",
    variantId: "44760510660642",
  },
];

export function findSku(skuCode) {
  return [...AMBASSADOR_SKUS, ...RETIRED_SKUS].find((s) => s.sku === skuCode);
}
