import { Router } from "express";
import { db } from "../db.js";

export const adminRouter = Router();

// Simple shared-secret gate — not a real auth system, just enough to keep
// this off Google and away from randos. Set ADMIN_TOKEN in your env and
// visit /admin/orders?token=whatever-you-set.
function requireAdminToken(req, res, next) {
  const token = req.query.token || req.get("X-Admin-Token");
  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).send("ADMIN_TOKEN is not set in the environment.");
  }
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Missing or wrong ?token=");
  }
  next();
}

// Manual tracking dashboard: shows every order with its ship/delivery
// status and a one-click "Mark Delivered" button. Marking an order
// delivered is what starts the day 7/10/13 follow-up clock — same as
// AfterShip's auto-detection used to, just triggered by you instead.
adminRouter.get("/admin/orders", requireAdminToken, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, a.name AS creator_name, a.email AS creator_email
    FROM orders o
    JOIN applications a ON a.id = o.application_id
    ORDER BY o.created_at DESC
  `).all();

  const rows = orders.map((o) => {
    const deliveredBadge = o.delivered_at
      ? `<span class="ok">Delivered ${escapeHtml(o.delivered_at)}</span>`
      : o.tracking_number
      ? `<button class="mark-btn" data-id="${o.id}">Mark Delivered</button>`
      : `<span class="muted">No tracking yet</span>`;

    return `
      <tr>
        <td>${escapeHtml(o.shopify_order_name || "—")}</td>
        <td>${escapeHtml(o.creator_name)}<br><span class="muted">${escapeHtml(o.creator_email)}</span></td>
        <td>${escapeHtml(o.sku)}</td>
        <td>${escapeHtml(o.tracking_number || "—")}${o.tracking_company ? ` <span class="muted">(${escapeHtml(o.tracking_company)})</span>` : ""}</td>
        <td>${escapeHtml(o.shipped_at || "—")}</td>
        <td>${deliveredBadge}</td>
        <td>${o.followup_count} / 3</td>
      </tr>`;
  }).join("\n");

  res.set("Content-Type", "text/html").send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Ambassador Orders</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e5e5; font-size: 0.9rem; vertical-align: top; }
  th { color: #666; font-weight: 600; }
  .muted { color: #888; font-size: 0.8rem; }
  .ok { color: #0a7d34; font-weight: 600; }
  button.mark-btn { background: #1a1a1a; color: #fff; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  button.mark-btn:hover { background: #333; }
  button.mark-btn:disabled { background: #aaa; cursor: default; }
</style>
</head>
<body>
  <h1>Ambassador Orders — manual delivery tracking</h1>
  <p class="muted">Click "Mark Delivered" once tracking shows the package arrived. That starts the day 7/10/13 follow-up email tagging.</p>
  <table>
    <thead>
      <tr><th>Order</th><th>Creator</th><th>SKU</th><th>Tracking</th><th>Shipped</th><th>Delivered</th><th>Follow-ups</th></tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="7" class="muted">No orders yet.</td></tr>`}</tbody>
  </table>
  <script>
    document.querySelectorAll(".mark-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Marking...";
        const id = btn.dataset.id;
        const token = new URLSearchParams(location.search).get("token");
        const res = await fetch(\`/admin/orders/\${id}/mark-delivered?token=\${encodeURIComponent(token)}\`, { method: "POST" });
        if (res.ok) {
          location.reload();
        } else {
          btn.disabled = false;
          btn.textContent = "Mark Delivered";
          alert("Failed to update — check server logs.");
        }
      });
    });
  </script>
</body>
</html>`);
});

adminRouter.post("/admin/orders/:id/mark-delivered", requireAdminToken, (req, res) => {
  const result = db.prepare(`
    UPDATE orders SET delivered_at = datetime('now') WHERE id = ? AND delivered_at IS NULL
  `).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Order not found or already marked delivered." });
  res.json({ ok: true });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
