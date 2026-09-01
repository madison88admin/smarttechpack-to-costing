// Renders every ```mermaid block in docs/corrected-system-flow.md to PNG via mermaid.ink.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd());
const src = readFileSync(join(root, "docs/corrected-system-flow.md"), "utf8");
const lines = src.split("\n");
const blocks = [];
let heading = "untitled";
let inBlock = false;
let buf = [];
for (const line of lines) {
  if (/^#{2,3} /.test(line)) {
    heading = line.replace(/^#+ /, "").trim();
  } else if (/^```mermaid\s*$/.test(line)) {
    inBlock = true;
    buf = [];
  } else if (inBlock && /^```\s*$/.test(line)) {
    blocks.push({ heading, code: buf.join("\n") });
    inBlock = false;
  } else if (inBlock) {
    buf.push(line);
  }
}
function b64url(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const outDir = join(root, "docs/diagrams");
mkdirSync(outDir, { recursive: true });
for (const b of blocks) {
  const name = "corrected-" + b.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const url = "https://mermaid.ink/img/" + b64url(b.code) + "?type=png";
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error("FAIL " + name + " (" + res.status + "): " + (await res.text()).slice(0, 200));
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 16 || buf.subarray(0, 4).toString("hex") !== "89504e47") {
    console.error("FAIL " + name + ": not a PNG (" + buf.length + " bytes)");
    continue;
  }
  writeFileSync(join(outDir, name + ".png"), buf);
  console.log("OK " + name + ".png (" + buf.length + " bytes)");
}
