const PANDADOC_API = "https://api.pandadoc.com/public/v1";

function authHeaders() {
  return {
    Authorization: `API-Key ${process.env.PANDADOC_API_KEY}`,
    "Content-Type": "application/json",
  };
}

/**
 * Creates a PandaDoc document from your template and immediately sends it
 * to the applicant for signature.
 *
 * Set up once in PandaDoc:
 *  1. Build the ambassador agreement as a Template.
 *  2. Add a Signer role (name it "Creator") with a signature field.
 *  3. Add text tokens in the template body: {{Creator.Name}}, {{sku_name}}, {{application_date}}
 *  4. Copy the Template ID into PANDADOC_TEMPLATE_ID.
 */
export async function createAndSendContract({ application, skuTitle }) {
  const createRes = await fetch(`${PANDADOC_API}/documents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      name: `Nail Pop Studio Ambassador Agreement — ${application.name}`,
      template_uuid: process.env.PANDADOC_TEMPLATE_ID,
      recipients: [
        {
          email: application.email,
          first_name: application.name.split(" ")[0],
          last_name: application.name.split(" ").slice(1).join(" ") || "-",
          role: "Creator",
        },
      ],
      tokens: [
        { name: "sku_name", value: skuTitle },
        { name: "application_date", value: new Date().toLocaleDateString() },
      ],
    }),
  });

  if (!createRes.ok) {
    throw new Error(`PandaDoc create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const doc = await createRes.json();

  // Document needs a moment to finish processing before it can be sent
  await waitUntilDocumentReady(doc.id);

  const sendRes = await fetch(`${PANDADOC_API}/documents/${doc.id}/send`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      message: "Hi! Please review and sign your Nail Pop Studio ambassador agreement.",
      subject: "Sign your Nail Pop Studio ambassador agreement",
      silent: false,
    }),
  });

  if (!sendRes.ok) {
    throw new Error(`PandaDoc send failed: ${sendRes.status} ${await sendRes.text()}`);
  }

  return doc.id;
}

async function waitUntilDocumentReady(documentId, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${PANDADOC_API}/documents/${documentId}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.status === "document.draft") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("PandaDoc document never left 'uploaded/processing' state");
}
