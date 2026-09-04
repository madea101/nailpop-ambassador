import cron from "node-cron";
import { db } from "../db.js";
import { tagOrderForFollowup, FOLLOWUP_TAGS } from "../lib/shopifyEmailTrigger.js";

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
  // Tagging the order is the whole job here — the actual send happens in
  // Shopify Flow, triggered off the tag (see README "Email setup").
  const delivered = db.prepare(`
    SELECT * FROM orders WHERE delivered_at IS NOT NULL AND followup_count < ?
  `).all(MAX_FOLLOWUPS);

  const now = new Date();

  for (const order of delivered) {
    const deliveredAt = new Date(order.delivered_at + "Z");
    const daysSinceDelivery = Math.floor((now - deliveredAt) / (1000 * 60 * 60 * 24));

    const nextFollowupDueAtDay = 7 + order.followup_count * 3; // 7, 10, 13
    if (daysSinceDelivery < nextFollowupDueAtDay) continue;

    const tag = FOLLOWUP_TAGS[order.followup_count];

    try {
      await tagOrderForFollowup({ shopifyOrderId: order.shopify_order_id, tag });
      db.prepare(`
        UPDATE orders SET followup_count = followup_count + 1, last_followup_at = datetime('now')
        WHERE id = ?
      `).run(order.id);
      console.log(`Tagged order ${order.shopify_order_name} with "${tag}" (follow-up #${order.followup_count + 1})`);
    } catch (err) {
      console.error(`Follow-up tagging failed for order ${order.id}`, err);
    }
  }
}
