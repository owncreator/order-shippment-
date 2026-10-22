const crypto = require("node:crypto");

function getKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is required");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

// AES-256-GCM: each value gets a fresh 96-bit nonce and authenticated tag.
// Store ciphertext as v1.nonce.tag.data, all base64url encoded.
function encrypt(value) {
  if (value === null || value === undefined || value === "") return null;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", nonce.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(payload) {
  if (!payload) return null;
  const [version, nonce, tag, data] = payload.split(".");
  if (version !== "v1" || !nonce || !tag || !data) throw new Error("Unsupported encrypted payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
