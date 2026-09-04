import PDFDocument from "pdfkit";

function documensoUrl(pathSegment) {
  const base = process.env.DOCUMENSO_API_URL || "https://documenso-app-production-fb8a.up.railway.app/api/v2";
  return `${base}/${pathSegment}`;
}

function authHeaders() {
  // Documenso's public API takes the raw key in the Authorization header
  // (no "Bearer " prefix) — see Settings > API Tokens on your instance.
  return { Authorization: process.env.DOCUMENSO_API_KEY };
}

/**
 * Builds the ambassador agreement as a PDF, in-memory, filled in with this
 * applicant's info. This is a starting draft — read it over and edit the
 * wording in the text below before real applicants start signing it.
 */
function buildContractPdf({ application, skuTitle }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 72 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const today = new Date().toLocaleDateString();

    doc.fontSize(16).font("Helvetica-Bold").text("Nail Pop Studio — Ambassador Agreement", { align: "center" });
    doc.moveDown(1.5);

    doc.fontSize(10).font("Helvetica");
    doc.text(`Date: ${today}`);
    doc.text(`Creator: ${application.name} (${application.email})`);
    doc.text(`Product gifted: ${skuTitle}`);
    doc.moveDown(1);

    doc.fontSize(11);
    doc.text(
      `This Ambassador Agreement ("Agreement") is entered into between Nail Pop Studio ("Brand") and ${application.name} ("Creator").`
    );
    doc.moveDown(0.75);

    const clauses = [
      [
        "1. Gift.",
        "Brand will ship Creator one (1) complimentary unit of the product listed above, at no cost to Creator, in exchange for the content described below.",
      ],
      [
        "2. Content requirement.",
        "Within 14 days of receiving the product, Creator will post at least one (1) video on TikTok featuring the product, and must tag @thenailpopstudio in the post.",
      ],
      [
        "3. Content usage.",
        "Creator grants Brand a non-exclusive, royalty-free license to repost, share, and use Creator's TikTok content (in whole or in part) across Brand's own marketing channels, with credit to Creator where practical.",
      ],
      [
        "4. No cash compensation.",
        "This Agreement covers gifted product only. It does not create an employment, agency, or paid-partnership relationship.",
      ],
      [
        "5. FTC disclosure.",
        "Creator agrees to comply with FTC endorsement guidelines and to clearly disclose the gifted nature of the product in their post (e.g. #gifted).",
      ],
    ];

    for (const [heading, body] of clauses) {
      doc.font("Helvetica-Bold").text(heading, { continued: true });
      doc.font("Helvetica").text(` ${body}`);
      doc.moveDown(0.5);
    }

    doc.moveDown(1);
    doc.text("By signing below, Creator agrees to the terms above.");
    doc.moveDown(3);
    doc.text("Creator signature: ___________________________________        Date: _______________");

    doc.end();
  });
}

/**
 * Builds the agreement PDF, uploads it to Documenso as a new envelope with
 * one signer, and immediately sends it to the applicant's email.
 *
 * No template to maintain in Documenso's UI — the whole document is
 * generated here from the applicant's data, every time.
 */
export async function createAndSendContract({ application, skuTitle }) {
  const pdfBuffer = await buildContractPdf({ application, skuTitle });

  const form = new FormData();
  form.append(
    "payload",
    JSON.stringify({
      type: "DOCUMENT",
      title: `Nail Pop Studio Ambassador Agreement — ${application.name}`,
      recipients: [
        {
          email: application.email,
          name: application.name,
          role: "SIGNER",
          fields: [
            { type: "SIGNATURE", page: 1, positionX: 15, positionY: 80, width: 40, height: 5 },
            { type: "DATE", page: 1, positionX: 62, positionY: 80, width: 25, height: 5 },
          ],
        },
      ],
    })
  );
  form.append("files", new Blob([pdfBuffer], { type: "application/pdf" }), "ambassador-agreement.pdf");

  const createRes = await fetch(documensoUrl("envelope/create"), {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!createRes.ok) {
    throw new Error(`Documenso create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const { id: envelopeId } = await createRes.json();

  const sendRes = await fetch(documensoUrl("envelope/distribute"), {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ envelopeId }),
  });
  if (!sendRes.ok) {
    throw new Error(`Documenso send failed: ${sendRes.status} ${await sendRes.text()}`);
  }

  return envelopeId;
}
