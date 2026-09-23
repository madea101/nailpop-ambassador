import cron from "node-cron";
import { db } from "../db.js";
import { tagOrderForFollowup, FOLLOWUP_TAGS } from "../lib/shopifyEmailTrigger.js";
import { sendFollowupEmail } from "../lib/followupEmails.js";

const MAX_FOLLOWUPS = FOLLOWUP_TAGS.length; // stop nudging after this many stages

export function startCronJobs() {
  // Delivery detection is manual now (visit /admin/orders and click
  // "Mark Delivered") — used to be an AfterShip poll every 3h here.

  // Tag orders for due follow-ups once a day, 9am server time —
  // Shopify Flow watches for these tags and sends the actual email.
  cron.schedule("0 9 * * *", tagDueFollowups);

  console.log("Cron jobs scheduled: follow-up tagging daily at 9am (delivery marking is manual via /admin/orders)");
}

async function tagDueFollowups() {
  // 7 days after delivery, then every 3 days after that, up to MAX_FOLLOWUPS.
  // The email is sent directly via Resend (lib/followupEmails.js) — Shopify
  // Flow has no merchant-facing "tags added" trigger for orders, so we can't
  // rely on Flow to catch the tag and send it. The order still gets tagged
  // too, purely for your own visibility in Shopify admin — it's not required
  // for the email to go out.
  // Orders marked content_created (from /admin/orders) are skipped entirely —
  // once a creator's content is actually posted, no more nudge emails go out.
  const delivered = db.prepare(`
    SELECT o.*, a.name AS creator_name, a.email AS creator_email
    FROM orders o
    JOIN applications a ON a.id = o.application_id
    WHERE o.delivered_at IS NOT NULL AND o.followup_count < ? AND o.content_created_at IS NULL
  `).all(MAX_FOLLOWUPS);

  const now = new Date();

  for (const order of delivered) {
    const deliveredAt = new Date(order.delivered_at + "Z");
    const daysSinceDelivery = Math.floor((now - deliveredAt) / (1000 * 60 * 60 * 24));

    const nextFollowupDueAtDay = 7 + order.followup_count * 3; // 7, 10, 13
    if (daysSinceDelivery < nextFollowupDueAtDay) continue;

    const tag = FOLLOWUP_TAGS[order.followup_count];

    try {
      await sendFollowupEmail({ to: order.creator_email, name: order.creator_name, tag });
      db.prepare(`
        UPDATE orders SET followup_count = followup_count + 1, last_followup_at = datetime('now')
        WHERE id = ?
      `).run(order.id);
      console.log(`Sent "${tag}" follow-up email to ${order.creator_email} for order ${order.shopify_order_name}`);
    } catch (err) {
      console.error(`Follow-up email failed for order ${order.id}`, err);
      continue; // don't mark as sent, and skip the (non-essential) Shopify tag below
    }

    // Best-effort — purely cosmetic tagging in Shopify, never blocks the email above.
    try {
      await tagOrderForFollowup({ shopifyOrderId: order.shopify_order_id, tag });
    } catch (err) {
      console.error(`Shopify tagging (cosmetic) failed for order ${order.id}`, err);
    }
  }
}
