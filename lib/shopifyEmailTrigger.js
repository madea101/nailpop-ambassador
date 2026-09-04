// This app doesn't send follow-up emails itself. Shopify Email has no API
// for one-off triggered sends (Shopify's own answer to this is "not supported
// natively — use a 3rd-party service or a webhook"). So instead, this app tags
// the order at the right moment, and a Shopify Flow you build watches for that
// tag and fires the actual Shopify Email send. See README.md "Email setup" for
// how to build the 3 Flow workflows this expects.

import { authHeaders } from "./shopify.js";

function shopifyUrl(pathSegment) {
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  return `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${version}/${pathSegment}`;
}

// One tag per follow-up stage — Flow triggers off these, in order.
export const FOLLOWUP_TAGS = ["followup-day7", "followup-day10", "followup-day13"];

/**
 * Adds a follow-up tag to the order. Shopify Flow (which you configure once,
 * see README) watches for "order tags added" and fires the matching
 * Shopify Email send from there — this app never talks to an email API.
 */
export async function tagOrderForFollowup({ shopifyOrderId, tag }) {
  const getRes = await fetch(shopifyUrl(`orders/${shopifyOrderId}.json?fields=tags`), {
    headers: await authHeaders(),
  });
  if (!getRes.ok) {
    throw new Error(`Shopify order fetch failed: ${getRes.status} ${await getRes.text()}`);
  }
  const { order } = await getRes.json();
  const existingTags = order.tags ? order.tags.split(",").map((t) => t.trim()) : [];
  if (existingTags.includes(tag)) return; // already tagged, Flow already fired

  const newTags = [...existingTags, tag].join(", ");

  const putRes = await fetch(shopifyUrl(`orders/${shopifyOrderId}.json`), {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify({ order: { id: shopifyOrderId, tags: newTags } }),
  });
  if (!putRes.ok) {
    throw new Error(`Shopify order tag update failed: ${putRes.status} ${await putRes.text()}`);
  }
}
