import fs from "node:fs";
import path from "node:path";
import type { BomLineResult } from "./normalize";

const cacheDir = path.join(process.cwd(), "tmp", "nextgen-bom-cache");

function fileFor(key: string) {
  return path.join(cacheDir, `${key.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

export function readBomCache(key: string): BomLineResult[] | null {
  try {
    const value = JSON.parse(fs.readFileSync(fileFor(key), "utf8"));
    return Array.isArray(value?.data) ? value.data : null;
  } catch {
    return null;
  }
}

export function writeBomCache(key: string, data: BomLineResult[]) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(fileFor(key), JSON.stringify({ cachedAt: new Date().toISOString(), data }, null, 2));
  } catch {
    // Cache is an optimization and must never block the request.
  }
}
