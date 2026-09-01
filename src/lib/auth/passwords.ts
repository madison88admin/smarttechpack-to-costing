import { createHash, randomBytes, timingSafeEqual } from "crypto";

const iterations = 120_000;
const keyLength = 32;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(`${salt}:${iterations}:${password}`)
    .digest("hex");

  return `tpv1:${iterations}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash?: string | null) {
  if (!storedHash?.startsWith("tpv1:")) return false;

  const [, storedIterations, salt, hash] = storedHash.split(":");
  if (!storedIterations || !salt || !hash) return false;

  const candidate = createHash("sha256")
    .update(`${salt}:${storedIterations}:${password}`)
    .digest("hex");
  const candidateBuffer = Buffer.from(candidate, "hex");
  const storedBuffer = Buffer.from(hash, "hex");

  return candidateBuffer.length === storedBuffer.length && timingSafeEqual(candidateBuffer, storedBuffer);
}
