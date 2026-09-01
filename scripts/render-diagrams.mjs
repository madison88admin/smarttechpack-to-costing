// Renders every ```mermaid block in docs/system-flow-diagram.md to PNG
// via mermaid.ink GET /img/<base64url>?type=png, saved under docs/diagrams/.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "docs/system-flow-diagram.md"), "utf8");

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

const map = {
  "1. End-to-End System Flow": "system-flow",
  "2. Status Flow — as implemented (v2)": "status-flow",
  "2b. Customer Status Flow (post-approval, PBD-owned)": "customer-status-flow",
  "Role → Workflow Step Mapping": "role-mapping",
  "4b. Swimlane — Who Owns Each Step": "swimlane"
};
function slug(name) {
  if (map[name]) return map[name];
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function b64url(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const outDir = join(root, "docs/diagrams");
mkdirSync(outDir, { recursive: true });

for (const b of blocks) {
  const name = slug(b.heading);
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
  const file = join(outDir, name + ".png");
  writeFileSync(file, buf);
  console.log("OK " + name + ".png (" + buf.length + " bytes)");
}
