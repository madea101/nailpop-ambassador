import { Router } from "express";
import { db } from "../db.js";
import { sendFollowupEmail } from "../lib/followupEmails.js";

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

// Full dashboard: every application field typed on the form, plus contract
// status, shipping/tracking, and a "Mark Delivered" + "Mark content created"
// control per order. Marking delivered starts the day 7/10/13 follow-up
// clock; marking content created stops it — no more emails go to that
// creator once their post is actually done, no matter how many nudges are
// left in the sequence.
//
// The table is built client-side from an embedded JSON array so the search
// box, filters, and sort dropdown can all work instantly without a page
// reload or extra server round trips.
adminRouter.get("/admin/orders", requireAdminToken, (req, res) => {
  const rows = db.prepare(`
    SELECT
      a.id AS application_id, a.name, a.email, a.phone, a.social_handle, a.platform,
      a.followers, a.sku AS application_sku, a.address1, a.address2, a.city, a.province,
      a.zip, a.country, a.marketing_opt_in, a.status AS application_status,
      a.created_at AS applied_at,
      c.status AS contract_status, c.signed_at,
      o.id AS order_id, o.shopify_order_name, o.sku AS order_sku, o.tracking_number,
      o.tracking_company, o.shipped_at, o.delivered_at, o.followup_count,
      o.last_followup_at, o.content_created_at
    FROM applications a
    LEFT JOIN contracts c ON c.application_id = a.id
    LEFT JOIN orders o ON o.application_id = a.id
    ORDER BY a.created_at DESC
  `).all();

  const token = req.query.token || "";

  // JSON.stringify can legally emit "</script>" inside a string value (e.g.
  // someone's name), which would break out of the script tag — escape it.
  const dataJson = JSON.stringify(rows).replace(/</g, "\\u003c");
  const tokenJson = JSON.stringify(token).replace(/</g, "\\u003c");

  res.set("Content-Type", "text/html").send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Ambassador Applications</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
  .lede { color: #666; font-size: 0.9rem; margin-top: 0; }

  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 1rem 0; }
  .toolbar input[type="text"], .toolbar select {
    padding: 0.45rem 0.6rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem;
    font-family: inherit; background: #fff; color: #1a1a1a;
  }
  .toolbar input[type="text"] { width: 240px; }
  .toolbar label { font-size: 0.78rem; color: #666; display: flex; flex-direction: column; gap: 3px; }
  .counts { font-size: 0.8rem; color: #666; margin-left: auto; }
  .clear-btn { background: none; border: 1px solid #ddd; border-radius: 6px; padding: 0.45rem 0.7rem; font-size: 0.8rem; cursor: pointer; color: #1a1a1a; }
  .clear-btn:hover { background: #f5f5f5; }

  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #e5e5e5; font-size: 0.85rem; vertical-align: top; white-space: nowrap; }
  td.addr { white-space: normal; max-width: 220px; }
  th { color: #666; font-weight: 600; position: sticky; top: 0; background: #fff; }
  .muted { color: #888; font-size: 0.78rem; }
  .ok { color: #0a7d34; font-weight: 600; }
  button.mark-btn { background: #1a1a1a; color: #fff; border: none; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; }
  button.mark-btn:hover { background: #333; }
  button.content-btn { background: #f0f0f0; color: #1a1a1a; border: 1px solid #ddd; padding: 0.4rem 0.75rem; border-radius: 6px; cursor: pointer; font-size: 0.8rem; white-space: nowrap; }
  button.content-btn.done { background: #e6f6ec; color: #0a7d34; border-color: #b8e6c8; }
  button:disabled { opacity: 0.5; cursor: default; }
  .table-wrap { overflow-x: auto; }
  .empty-row td { color: #888; padding: 1.5rem 0.75rem; }
</style>
</head>
<body>
  <h1>Ambassador applications</h1>
  <p class="lede">Everything typed on the application form, plus contract, shipping, and follow-up status. "Mark content created" stops all future follow-up emails to that creator, however many nudges are left.</p>

  <div class="toolbar">
    <label>Search
      <input type="text" id="searchInput" placeholder="Name, email, @handle, SKU, order #…" />
    </label>
    <label>Application status
      <select id="statusFilter">
        <option value="">All</option>
        <option value="pending_contract">Pending contract</option>
        <option value="contract_sent">Contract sent</option>
        <option value="contract_signed">Contract signed</option>
        <option value="order_placed">Order placed</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </label>
    <label>Delivered
      <select id="deliveredFilter">
        <option value="">All</option>
        <option value="yes">Delivered</option>
        <option value="no">Not delivered yet</option>
      </select>
    </label>
    <label>Content created
      <select id="contentFilter">
        <option value="">All</option>
        <option value="yes">Done</option>
        <option value="no">Not yet</option>
      </select>
    </label>
    <label>Sort by
      <select id="sortBy">
        <option value="applied_desc">Newest applied</option>
        <option value="applied_asc">Oldest applied</option>
        <option value="name_asc">Name (A–Z)</option>
        <option value="delivered_desc">Most recently delivered</option>
        <option value="followups_desc">Most follow-ups sent</option>
        <option value="status">Application status</option>
      </select>
    </label>
    <button type="button" class="clear-btn" id="clearBtn">Clear filters</button>
    <span class="counts" id="counts"></span>
  </div>

  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Applicant</th><th>Platform</th><th>SKU</th><th>Ship to</th><th>Opt-in</th>
        <th>Application</th><th>Contract</th><th>Order</th><th>Tracking</th><th>Shipped</th>
        <th>Delivered</th><th>Follow-ups</th><th>Content created?</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  </div>

  <script>
    const DATA = ${dataJson};
    const TOKEN = ${tokenJson};

    const STATUS_LABELS = {
      pending_contract: "Pending contract",
      contract_sent: "Contract sent",
      contract_signed: "Contract signed",
      order_placed: "Order placed",
      cancelled: "Cancelled",
    };
    const STATUS_ORDER = ["pending_contract", "contract_sent", "contract_signed", "order_placed", "cancelled"];

    function escapeHtml(str) {
      return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }

    function matchesSearch(r, q) {
      if (!q) return true;
      const haystack = [r.name, r.email, r.social_handle, r.application_sku, r.order_sku, r.shopify_order_name]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    }

    function applyFiltersAndSort() {
      const q = document.getElementById("searchInput").value.trim().toLowerCase();
      const statusVal = document.getElementById("statusFilter").value;
      const deliveredVal = document.getElementById("deliveredFilter").value;
      const contentVal = document.getElementById("contentFilter").value;
      const sortVal = document.getElementById("sortBy").value;

      let rows = DATA.filter((r) => {
        if (!matchesSearch(r, q)) return false;
        if (statusVal && r.application_status !== statusVal) return false;
        if (deliveredVal === "yes" && !r.delivered_at) return false;
        if (deliveredVal === "no" && r.delivered_at) return false;
        if (contentVal === "yes" && !r.content_created_at) return false;
        if (contentVal === "no" && r.content_created_at) return false;
        return true;
      });

      rows.sort((a, b) => {
        switch (sortVal) {
          case "applied_asc":
            return new Date(a.applied_at) - new Date(b.applied_at);
          case "name_asc":
            return (a.name || "").localeCompare(b.name || "");
          case "delivered_desc":
            if (!a.delivered_at && !b.delivered_at) return 0;
            if (!a.delivered_at) return 1;
            if (!b.delivered_at) return -1;
            return new Date(b.delivered_at) - new Date(a.delivered_at);
          case "followups_desc":
            return (b.followup_count || 0) - (a.followup_count || 0);
          case "status":
            return STATUS_ORDER.indexOf(a.application_status) - STATUS_ORDER.indexOf(b.application_status);
          case "applied_desc":
          default:
            return new Date(b.applied_at) - new Date(a.applied_at);
        }
      });

      renderRows(rows);
      document.getElementById("counts").textContent = rows.length + " of " + DATA.length + " applications";
    }

    function renderRows(rows) {
      const tbody = document.getElementById("tbody");

      if (!rows.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="13">No applications match these filters.</td></tr>';
        return;
      }

      tbody.innerHTML = rows.map((r) => {
        const addr = [r.address1, r.address2, [r.city, r.province, r.zip].filter(Boolean).join(", "), r.country]
          .filter(Boolean).join(", ");

        const deliveredCell = r.delivered_at
          ? '<span class="ok">Delivered ' + escapeHtml(r.delivered_at) + '</span>'
          : r.order_id
          ? (r.tracking_number
              ? '<button class="mark-btn" data-action="mark-delivered" data-id="' + r.order_id + '">Mark Delivered</button>'
              : '<span class="muted">No tracking yet</span>')
          : '<span class="muted">No order yet</span>';

        const contentDone = !!r.content_created_at;
        const contentCell = r.order_id
          ? '<button class="content-btn ' + (contentDone ? "done" : "") + '" data-action="toggle-content" data-id="' + r.order_id + '" data-created="' + contentDone + '">'
            + (contentDone ? "&#10003; Done — emails stopped" : "Mark content created") + '</button>'
          : '<span class="muted">—</span>';

        return '<tr>'
          + '<td><strong>' + escapeHtml(r.name) + '</strong><br><span class="muted">' + escapeHtml(r.email) + '</span>'
            + (r.phone ? '<br><span class="muted">' + escapeHtml(r.phone) + '</span>' : '') + '</td>'
          + '<td>' + escapeHtml(r.platform || "—") + '<br><span class="muted">' + escapeHtml(r.social_handle || "")
            + (r.followers ? ' · ' + Number(r.followers).toLocaleString() + ' followers' : '') + '</span></td>'
          + '<td>' + escapeHtml(r.order_sku || r.application_sku) + '</td>'
          + '<td class="addr">' + (escapeHtml(addr) || "—") + '</td>'
          + '<td>' + (r.marketing_opt_in ? "Yes" : "No") + '</td>'
          + '<td>' + escapeHtml(STATUS_LABELS[r.application_status] || r.application_status || "—") + '</td>'
          + '<td>' + escapeHtml(r.contract_status || "—") + (r.signed_at ? '<br><span class="muted">Signed ' + escapeHtml(r.signed_at) + '</span>' : '') + '</td>'
          + '<td>' + escapeHtml(r.shopify_order_name || "—") + '</td>'
          + '<td>' + escapeHtml(r.tracking_number || "—") + (r.tracking_company ? '<br><span class="muted">' + escapeHtml(r.tracking_company) + '</span>' : '') + '</td>'
          + '<td>' + escapeHtml(r.shipped_at || "—") + '</td>'
          + '<td>' + deliveredCell + '</td>'
          + '<td>' + (r.order_id ? r.followup_count + ' / 3' : "—") + (r.last_followup_at ? '<br><span class="muted">Last ' + escapeHtml(r.last_followup_at) + '</span>' : '') + '</td>'
          + '<td>' + contentCell + '</td>'
          + '</tr>';
      }).join("\\n");

      tbody.querySelectorAll("[data-action='mark-delivered']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          btn.textContent = "Marking...";
          const id = btn.dataset.id;
          const res = await fetch("/admin/orders/" + id + "/mark-delivered?token=" + encodeURIComponent(TOKEN), { method: "POST" });
          if (res.ok) {
            const order = DATA.find((r) => String(r.order_id) === String(id));
            if (order) order.delivered_at = new Date().toISOString();
            applyFiltersAndSort();
          } else {
            btn.disabled = false;
            btn.textContent = "Mark Delivered";
            alert("Failed to update — check server logs.");
          }
        });
      });

      tbody.querySelectorAll("[data-action='toggle-content']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          const currentlyDone = btn.dataset.created === "true";
          btn.disabled = true;
          const res = await fetch("/admin/orders/" + id + "/content-created?token=" + encodeURIComponent(TOKEN), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ created: !currentlyDone }),
          });
          if (res.ok) {
            const order = DATA.find((r) => String(r.order_id) === String(id));
            if (order) order.content_created_at = currentlyDone ? null : new Date().toISOString();
            applyFiltersAndSort();
          } else {
            btn.disabled = false;
            alert("Failed to update — check server logs.");
          }
        });
      });
    }

    document.getElementById("searchInput").addEventListener("input", applyFiltersAndSort);
    document.getElementById("statusFilter").addEventListener("change", applyFiltersAndSort);
    document.getElementById("deliveredFilter").addEventListener("change", applyFiltersAndSort);
    document.getElementById("contentFilter").addEventListener("change", applyFiltersAndSort);
    document.getElementById("sortBy").addEventListener("change", applyFiltersAndSort);
    document.getElementById("clearBtn").addEventListener("click", () => {
      document.getElementById("searchInput").value = "";
      document.getElementById("statusFilter").value = "";
      document.getElementById("deliveredFilter").value = "";
      document.getElementById("contentFilter").value = "";
      document.getElementById("sortBy").value = "applied_desc";
      applyFiltersAndSort();
    });

    applyFiltersAndSort();
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

// Marks (or unmarks) a creator's content as done. While content_created_at is
// set, cron/jobs.js's tagDueFollowups skips this order entirely — no more
// day 7/10/13 emails go out, regardless of followup_count.
adminRouter.post("/admin/orders/:id/content-created", requireAdminToken, (req, res) => {
  const { created } = req.body || {};
  const order = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  db.prepare(`UPDATE orders SET content_created_at = ? WHERE id = ?`)
    .run(created ? new Date().toISOString() : null, req.params.id);

  res.json({ ok: true, contentCreated: !!created });
});

// Manual test send — fires one of the 3 follow-up emails right now, without
// waiting for the real day 7/10/13 timing or touching followup_count. Handy
// for confirming the email actually sends/arrives. Visit as a POST with
// ?token=ADMIN_TOKEN&tag=followup-day7 (or day10 / day13).
adminRouter.post("/admin/orders/:id/send-test-followup", requireAdminToken, async (req, res) => {
  const tag = req.query.tag || "followup-day7";
  const order = db.prepare(`
    SELECT o.*, a.name AS creator_name, a.email AS creator_email
    FROM orders o JOIN applications a ON a.id = o.application_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  try {
    await sendFollowupEmail({ to: order.creator_email, name: order.creator_name, tag });
    res.json({ ok: true, sentTo: order.creator_email, tag });
  } catch (err) {
    console.error("Test follow-up send failed", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});
