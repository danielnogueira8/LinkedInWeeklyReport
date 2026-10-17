import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// LeadShark keys can send DMs from a client's LinkedIn account, so they are
// encrypted at rest with AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
const VERSION = "v1";
const DEV_FALLBACK_SECRET = "local-development-only-secret";

let warned = false;

function key(): Buffer {
  let secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY is not set. Add it to your environment variables (see .env.example).");
    }
    if (!warned) {
      console.warn("ENCRYPTION_KEY is not set; using an insecure development key.");
      warned = true;
    }
    secret = DEV_FALLBACK_SECRET;
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unrecognised encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
