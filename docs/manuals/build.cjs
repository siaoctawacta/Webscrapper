/**
 * Renders the HTML manuals in this folder to PDF with headless Chromium.
 *   node docs/manuals/build.cjs
 * Output: docs/LeadFinder-Documentation-technique.pdf and docs/LeadFinder-Guide-utilisateur.pdf
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

/** Keep the cover page free of the footer: page 1 from a footer-less render + the rest from the footed one. */
function mergeCover(coverPdf, bodyPdf, out) {
  execFileSync("python3", [
    "-c",
    `import sys
from pypdf import PdfReader, PdfWriter
cover, body, out = sys.argv[1:4]
w = PdfWriter()
w.add_page(PdfReader(cover).pages[0])
r = PdfReader(body)
for p in r.pages[1:]:
    w.add_page(p)
w.add_metadata({"/Title": sys.argv[4], "/Author": "LeadFinder"})
with open(out, "wb") as f:
    w.write(f)`,
    coverPdf,
    bodyPdf,
    out,
    path.basename(out, ".pdf").replace(/-/g, " "),
  ]);
}

const only = process.argv[2];
const DOCS = [
  { src: "technique.html", out: "LeadFinder-Documentation-technique.pdf", label: "LeadFinder · Documentation technique" },
  { src: "guide.html", out: "LeadFinder-Guide-utilisateur.pdf", label: "LeadFinder · Guide d’utilisation" },
];

const footer = (label) => `
  <div style="width:100%;font-family:Geist,Inter,sans-serif;font-size:7.5pt;color:#8b8b96;padding:0 17mm;display:flex;justify-content:space-between;">
    <span>${label}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const d of DOCS.filter((x) => !only || x.src.startsWith(only))) {
    const file = path.join(__dirname, d.src);
    await page.goto("file://" + file, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(__dirname, "..", d.out);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manual-"));
    const base = { format: "A4", printBackground: true, preferCSSPageSize: true, tagged: true };
    await page.pdf({ ...base, path: path.join(tmp, "cover.pdf"), pageRanges: "1" });
    await page.pdf({
      ...base,
      path: path.join(tmp, "body.pdf"),
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: footer(d.label),
    });
    mergeCover(path.join(tmp, "cover.pdf"), path.join(tmp, "body.pdf"), out);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("wrote", path.relative(process.cwd(), out));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
