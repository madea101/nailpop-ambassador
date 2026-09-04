# Nail Pop Studio — Ambassador Pipeline

Creator applies → Documenso contract auto-sends → on signature, a comped Shopify order
is placed and shipped to them → once delivered, follow-up emails go out on day 7,
then every 3 days (up to 3 nudges).

## What this is (and isn't)

This is a small **Node.js server**, not a static HTML file — placing Shopify orders and
polling tracking needs a backend holding your API keys, plus a background job that
runs on a schedule. It has to run somewhere 24/7 (a $5-7/mo box on Railway or Render
works fine, or your own server).

## 1. Install & run locally

```bash
npm install
cp .env.example .env      # fill in the real values, see below
npm start
```

Visit `http://localhost:3000/apply.html` to see the form.

## 2. Documenso setup (self-hosted — no per-webhook plan fee)

PandaDoc gates API + webhook access behind a paid plan (~$40/mo). Instead, this
app is wired up to a **self-hosted Documenso** instance — free, open source,
same automated contract-and-webhook flow. It's already deployed as a second
service (`documenso-app`) + Postgres (`documenso-db`) in the same Railway
project as this app, at:

```
https://documenso-app-production-fb8a.up.railway.app
```

There's no template to build or maintain — `lib/documenso.js` generates the
ambassador agreement as a PDF from scratch for every applicant (their name,
SKU, and today's date filled in), uploads it, places a signature field, and
sends it. **The contract wording in `lib/documenso.js` is a starting draft —
read it over and edit the clauses to match what you actually want creators
agreeing to before real applicants start signing.** It already requires a
TikTok post tagging **@thenailpopstudio** per your instructions.

Still to do, on your Documenso instance:

1. Visit the URL above and **sign up** — the first account you create becomes
   the instance admin. (Email delivery isn't configured yet — see the SMTP
   note below — so if signup asks for email verification and no email
   arrives, that's why.)
2. Settings → **API Tokens** → create a token → paste it in as
   `DOCUMENSO_API_KEY`.
3. Settings → **Webhooks** → Add webhook → URL
   `https://your-domain.com/webhooks/documenso` → event `DOCUMENT_COMPLETED`
   → secret: use the value already in `DOCUMENSO_WEBHOOK_SECRET` in your `.env`
   (not shown here — real secrets never go in this file) so both sides match.

**SMTP (needed for signing emails to actually send):** Documenso needs an
SMTP account to email the contract to applicants. The simplest free option is
a Gmail app password:
1. myaccount.google.com/apppasswords → generate one for "Mail".
2. Send me the resulting 16-character password and I'll wire it into the
   `documenso-app` service's environment (`NEXT_PRIVATE_SMTP_*`) — nothing to
   do on the code side.

## 3. Shopify setup

`config/skus.js` is already filled in with your real variant IDs (Vanilla Cream
Square, Mirror Glaze Almond, Pearl Prism Square), and `SHOPIFY_STORE_DOMAIN` in
`.env` is set to your actual myshopify domain (`vrgj1t-ue.myshopify.com`).

Still to do — the app credentials have to come from your own Shopify login, a
connector session can't generate them for a standalone deployed app. Shopify
retired the old "reveal a static token" flow — new custom apps go through
**Dev Dashboard** and use a Client ID + Client secret instead:

1. `admin.shopify.com/store/vrgj1t-ue/settings/apps/development` → **Create an app**
   (if it forces you into "Dev Dashboard", that's expected now — that IS the
   current custom-app flow, not a wrong turn).
2. Configuration → Admin API scopes → enable `write_orders`, `read_orders`,
   `read_fulfillments` → Save → **Release** (new scope versions need releasing).
3. App settings tab → copy the **Client ID** and **Client secret** →
   `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`. The app exchanges these for a
   real access token itself (`lib/shopify.js`, refreshed automatically — tokens
   only last 24h).
4. Once deployed, register the fulfillment webhook manually — Shopify Admin →
   Settings → Notifications → scroll to **Webhooks** → **Create webhook** →
   topic `Fulfillment creation` → URL `https://your-domain.com/webhooks/shopify/fulfillment`
   → format JSON. Then scroll to the bottom of that same Notifications page —
   there's a **Webhook signing secret** (a store-wide secret, separate from
   the Client secret above) → copy it → `SHOPIFY_WEBHOOK_SECRET`.

## 4. Tracking (manual)

No tracking API is wired up — tracking numbers still get captured automatically
from the Shopify fulfillment webhook, but *delivered* status is set by you.

Visit `https://your-domain.com/admin/orders?token=ADMIN_TOKEN` (set `ADMIN_TOKEN`
to any random string in your env) to see every order with its tracking number,
and click **Mark Delivered** once a package arrives. That's what starts the day
7/10/13 follow-up clock — same role AfterShip's auto-detection used to play.

> Want automatic detection later? Add a poll against whatever tracking API you
> like (AfterShip, 17TRACK, ShipStation) in `cron/jobs.js`, calling the same
> `UPDATE orders SET delivered_at = ...` the admin route does.

## 5. Email setup (Resend — already automated, nothing to build)

Shopify Email has no API for one-off triggered sends, and it turns out
Shopify Flow doesn't have a merchant-facing "tags added" trigger for orders
either (only a developer-only webhook topic) — so the original tag-and-let-Flow-
catch-it design can't actually work. Instead, `lib/followupEmails.js` sends
the day 7/10/13 emails **directly**, using the same Resend account and
verified domain already set up for contract emails. There's nothing to build
in Shopify Admin for this — it's already live.

The order still gets tagged (`followup-day7` / `followup-day10` /
`followup-day13`) purely so you can see follow-up stage at a glance in
Shopify admin — that tag isn't what triggers the send, so nothing breaks if
tagging ever fails.

Want to test a send without waiting for the real 7/10/13 day timing? POST to
`/admin/orders/:id/send-test-followup?token=ADMIN_TOKEN&tag=followup-day7`
(swap the tag for day10/day13) — find the order's id from `/admin/orders`.

Want to change the email copy? Edit `EMAIL_COPY` in `lib/followupEmails.js`
directly — plain HTML strings, no template system.

> Want to swap to a different provider later (Klaviyo, SendGrid, etc.)?
> `lib/followupEmails.js` is the only file involved — replace the Resend
> `fetch` call with that provider's API.

## 6. Deploy

Any Node host works (Railway, Render, Fly.io, a DigitalOcean droplet). Steps are the same everywhere:
1. Push this folder to a git repo.
2. Set the same env vars from `.env.example` in your host's dashboard.
3. Set the start command to `npm start`.
4. Once you have a live URL, go back and update the Documenso and Shopify webhook
   URLs (steps 2.6 and 3.5) to point at it, and set `BASE_URL` to it too.

**Important — persistent storage:** `data/ambassador.db` is a file on local disk.
On Railway (and most container hosts) local disk is wiped on every redeploy
unless you attach a **volume** mounted at the `data/` directory. Without one,
every push to prod would silently erase all applications/contracts/orders.
Attach a volume before the first real applicant signs up.

## How the pieces connect

```
apply.html  --POST /api/apply-->  server
                                     |-- saves application
                                     |-- Documenso: create + send contract
                                     v
                          creator signs in their email
                                     |
                     Documenso webhook: DOCUMENT_COMPLETED
                                     v
                          server places $0 Shopify order
                                     |
                    Shopify webhook: fulfillments/create
                                     v
                          tracking number saved
                                     |
              you check /admin/orders, click "Mark Delivered"
                                     v
                    delivered_at set on the order row
                                     |
           cron (daily): day 7, 10, 13... -> tags order "followup-dayN"
                                     |
                    your Shopify Flow sees the tag added
                                     v
                       Flow fires the Shopify Email send
```

## Data

Everything is stored in a local SQLite file at `data/ambassador.db` — applications,
contract status, and order/tracking/follow-up state. No separate database to set up.
