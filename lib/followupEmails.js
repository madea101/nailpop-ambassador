// Sends the day 7/10/13 follow-up emails directly via Resend — the same
// service and verified domain already used to email signed contracts, so
// no Shopify Flow / Shopify Email setup is required. (Shopify Flow doesn't
// actually have a merchant-facing "tags added" trigger for orders — only a
// developer-only webhook topic — so the tag-and-let-Flow-catch-it approach
// this app originally shipped with can't work as designed.)

const RESEND_API_URL = "https://api.resend.com/emails";

function firstName(name) {
  return (name || "").split(" ")[0] || "there";
}

const EMAIL_COPY = {
  "followup-day7": {
    subject: "How's your Nail Pop set treating you? 💅",
    html: (name) => `
      <p>Hi ${firstName(name)},</p>
      <p>It's been about a week since your Nail Pop Studio set arrived — we'd love to see it in action!</p>
      <p>As a reminder, your ambassador agreement asks for one TikTok post featuring your set, tagging <strong>@thenailpopstudio</strong>. Whenever you're ready, we can't wait to see it and share it.</p>
      <p>Questions or need a hand with anything? Just reply to this email.</p>
      <p>— Nail Pop Studio</p>`,
  },
  "followup-day10": {
    subject: "Just checking in on your Nail Pop content 🎬",
    html: (name) => `
      <p>Hi ${firstName(name)},</p>
      <p>Quick nudge — if you haven't posted your TikTok featuring your Nail Pop Studio set yet, we'd love for you to when you get a chance. Tag <strong>@thenailpopstudio</strong> so we can find and share it!</p>
      <p>If something's come up or you need more time, no worries — just let us know.</p>
      <p>— Nail Pop Studio</p>`,
  },
  "followup-day13": {
    subject: "Last check-in — your Nail Pop post 🙏",
    html: (name) => `
      <p>Hi ${firstName(name)},</p>
      <p>This is our last nudge on this one — if you're still planning to post your TikTok featuring your Nail Pop Studio set, tag <strong>@thenailpopstudio</strong> whenever it's up.</p>
      <p>Thanks again for being part of the program — we really appreciate it either way.</p>
      <p>— Nail Pop Studio</p>`,
  },
};

/**
 * Sends the follow-up email for a given stage tag ("followup-day7", etc.)
 * directly via Resend's HTTP API — no Shopify Flow involved.
 */
export async function sendFollowupEmail({ to, name, tag }) {
  const copy = EMAIL_COPY[tag];
  if (!copy) throw new Error(`No email copy configured for follow-up tag "${tag}"`);
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_ADDRESS || "Nail Pop Studio <ambassador@nailpopstudio.com>",
      to,
      subject: copy.subject,
      html: copy.html(name),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}
