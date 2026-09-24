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
    sku: "NP-WHITE-FRENCH-ALM",
    title: "White French Almond Nails",
    variantId: "43778707587106",
  },
  {
    sku: "NP-PEARL-PRISM-SQ",
    title: "Pearl Prism Square Nails",
    variantId: "46469104500770",
  },
];

export function findSku(skuCode) {
  return AMBASSADOR_SKUS.find((s) => s.sku === skuCode);
}
