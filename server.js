import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { applyRouter } from "./routes/apply.js";
import { webhookRouter } from "./routes/webhooks.js";
import { adminRouter } from "./routes/admin.js";
import { startCronJobs } from "./cron/jobs.js";
import "./db.js"; // ensures tables exist on boot

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Keep the raw body around for webhook signature verification, then parse JSON.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));
app.use(applyRouter);
app.use(webhookRouter);
app.use(adminRouter);

app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Nail Pop ambassador app running on port ${port}`);
  startCronJobs();
});
