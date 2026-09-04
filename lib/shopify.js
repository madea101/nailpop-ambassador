function shopifyUrl(pathSegment) {
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  return `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${version}/${pathSegment}`;
}

// Dev Dashboard custom apps don't hand out a static admin token anymore —
// only a Client ID + Client secret. We exchange those for a real access
// token via the OAuth client_credentials grant, and cache it since it's
// only good for 24h (86399s). See README step 3.
let cachedToken = null; // { token, expiresAt (ms epoch) }

async function getAccessToken() {
  const bufferMs = 5 * 60 * 1000; // refresh 5 min before actual expiry
  if (cachedToken && cachedToken.expiresAt - bufferMs > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

export async function authHeaders() {
  return {
    "X-Shopify-Access-Token": await getAccessToken(),
    "Content-Type": "application/json",
  };
}

/**
 * Places a comped ($0) order for the signed ambassador, shipped to the
 * address they gave on the application form.
 */
export async function createAmbassadorOrder({ application, variantId }) {
  const payload = {
    order: {
      line_items: [
        {
          variant_id: Number(variantId),
          quantity: 1,
          price: "0.00", // comped — change if you want a partial-comp order instead
        },
      ],
      customer: {
        first_name: application.name.split(" ")[0],
        last_name: application.name.split(" ").slice(1).join(" ") || "-",
        email: application.email,
        // Required for Shopify Flow's "Send Marketing Email" action to fire later —
        // without this, the follow-up automations silently won't send.
        accepts_marketing: true,
        marketing_opt_in_level: "single_opt_in",
      },
      shipping_address: {
        first_name: application.name.split(" ")[0],
        last_name: application.name.split(" ").slice(1).join(" ") || "-",
        address1: application.address1,
        address2: application.address2 || "",
        city: application.city,
        province: application.province,
        zip: application.zip,
        country: application.country,
      },
      financial_status: "paid",
      tags: "ambassador",
      note: `Ambassador comp order — application #${application.id}`,
      send_receipt: true,
      send_fulfillment_receipt: true,
    },
  };

  const res = await fetch(shopifyUrl("orders.json"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Shopify order create failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return { id: data.order.id, name: data.order.name };
}

/**
 * Registers the fulfillment webhook this app needs. Run once (see README),
 * or set the webhook up manually in Shopify Admin > Settings > Notifications > Webhooks.
 */
export async function registerFulfillmentWebhook() {
  const res = await fetch(shopifyUrl("webhooks.json"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      webhook: {
        topic: "fulfillments/create",
        address: `${process.env.BASE_URL}/webhooks/shopify/fulfillment`,
        format: "json",
      },
    }),
  });
  return res.json();
}
