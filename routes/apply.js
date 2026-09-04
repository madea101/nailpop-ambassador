import { Router } from "express";
import { db } from "../db.js";
import { AMBASSADOR_SKUS, findSku } from "../config/skus.js";
import { createAndSendContract } from "../lib/documenso.js";

export const applyRouter = Router();

applyRouter.get("/api/skus", (req, res) => {
  res.json(AMBASSADOR_SKUS.map(({ sku, title }) => ({ sku, title })));
});

applyRouter.post("/api/apply", async (req, res) => {
  const {
    name, email, phone, socialHandle, platform, followers,
    sku, address1, address2, city, province, zip, country, marketingOptIn,
  } = req.body;

  if (!name || !email || !sku || !address1 || !city || !province || !zip || !country) {
    return res.status(400).json({ error: "Missing required fields." });
  }
  if (!marketingOptIn) {
    return res.status(400).json({ error: "Please agree to receive emails about your ambassador content — that's what triggers your delivery follow-ups." });
  }

  const skuInfo = findSku(sku);
  if (!skuInfo) {
    return res.status(400).json({ error: "Unknown SKU." });
  }

  const insert = db.prepare(`
    INSERT INTO applications
      (name, email, phone, social_handle, platform, followers, sku,
       address1, address2, city, province, zip, country, marketing_opt_in, status)
    VALUES (@name, @email, @phone, @socialHandle, @platform, @followers, @sku,
            @address1, @address2, @city, @province, @zip, @country, 1, 'pending_contract')
  `);
  const result = insert.run({
    name, email, phone: phone || null, socialHandle: socialHandle || null,
    platform: platform || null, followers: followers ? Number(followers) : null,
    sku, address1, address2: address2 || null, city, province, zip, country,
  });
  const applicationId = result.lastInsertRowid;

  try {
    const documentId = await createAndSendContract({
      application: { id: applicationId, name, email },
      skuTitle: skuInfo.title,
    });

    db.prepare(`INSERT INTO contracts (application_id, pandadoc_document_id, status) VALUES (?, ?, 'sent')`)
      .run(applicationId, documentId);
    db.prepare(`UPDATE applications SET status = 'contract_sent' WHERE id = ?`).run(applicationId);

    res.json({ ok: true, message: "Check your email to review and sign your ambassador agreement." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Application saved, but the contract failed to send. We'll follow up manually." });
  }
});
