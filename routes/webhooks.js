import { Router } from "express";
import crypto from "crypto";
import { db } from "../db.js";
import { findSku } from "../config/skus.js";
import { createAmbassadorOrder } from "../lib/shopify.js";

export const webhookRouter = Router();

// --- Documenso: fires on every envelope status change ---
webhookRouter.post("/webhooks/documenso", async (req, res) => {
  if (!verifyDocumensoSecret(req)) return res.status(401).send("bad secret");

  const event = req.body;
  const envelopeId = event?.payload?.envelopeId;
  const eventName = event?.event; // e.g. "DOCUMENT_COMPLETED"

  if (!envelopeId || eventName !== "DOCUMENT_COMPLETED") return res.sendStatus(200);

  // Column is still named pandadoc_document_id from the earlier PandaDoc
  // build — it now stores the Documenso envelope id, no migration needed.
  const contract = db.prepare(`SELECT * FROM contracts WHERE pandadoc_document_id = ?`).get(envelopeId);
  if (!contract || contract.status === "completed") return res.sendStatus(200);

  db.prepare(`UPDATE contracts SET status = 'completed', signed_at = datetime('now') WHERE id = ?`)
    .run(contract.id);

  const application = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(contract.application_id);
  db.prepare(`UPDATE applications SET status = 'contract_signed' WHERE id = ?`).run(application.id);

  const skuInfo = findSku(application.sku);
  try {
    const order = await createAmbassadorOrder({ application, variantId: skuInfo.variantId });
    db.prepare(`
      INSERT INTO orders (application_id, shopify_order_id, shopify_order_name, sku)
      VALUES (?, ?, ?, ?)
    `).run(application.id, String(order.id), order.name, application.sku);
    db.prepare(`UPDATE applications SET status = 'order_placed' WHERE id = ?`).run(application.id);
  } catch (err) {
    console.error("Order placement failed for application", application.id, err);
  }

  res.sendStatus(200);
});

// --- Shopify: fires when a fulfillment (shipment) is created on an order ---
webhookRouter.post("/webhooks/shopify/fulfillment", async (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).send("bad hmac");

  const fulfillment = req.body;
  const shopifyOrderId = String(fulfillment.order_id);
  const trackingNumber = fulfillment.tracking_number;
  const trackingCompany = fulfillment.tracking_company;

  const order = db.prepare(`SELECT * FROM orders WHERE shopify_order_id = ?`).get(shopifyOrderId);
  if (!order || !trackingNumber) return res.sendStatus(200);

  db.prepare(`
    UPDATE orders SET tracking_number = ?, tracking_company = ?, shipped_at = datetime('now')
    WHERE id = ?
  `).run(trackingNumber, trackingCompany, order.id);

  // Tracking is confirmed manually now — see /admin/orders. No auto delivery
  // detection call here (used to notify AfterShip).

  res.sendStatus(200);
});

function verifyDocumensoSecret(req) {
  // Documenso sends the webhook secret back as a plain string in this
  // header (not an HMAC signature) — set when the webhook was created in
  // Settings > Webhooks on your Documenso instance.
  const secretHeader = req.get("X-Documenso-Secret");
  if (!process.env.DOCUMENSO_WEBHOOK_SECRET || !secretHeader) return true; // skip if not configured yet
  return secretHeader === process.env.DOCUMENSO_WEBHOOK_SECRET;
}

function verifyShopifyHmac(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  // Webhook is registered manually via Settings > Notifications > Webhooks
  // (the connector is blocked from creating it via API for safety reasons).
  // That page signs with its own per-store "Webhook signing secret" shown
  // at the bottom of that same page — NOT the app's Client secret.
  if (!process.env.SHOPIFY_WEBHOOK_SECRET || !hmacHeader) return true; // skip if not configured yet
  const digest = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(req.rawBody || "", "utf8")
    .digest("base64");
  return digest === hmacHeader;
}
