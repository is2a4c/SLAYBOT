const crypto = require("crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function key() {
  return crypto
    .createHash("sha256")
    .update(process.env.SLAYNODE_MASTER_KEY || "")
    .digest();
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
function decrypt(value) {
  const raw = Buffer.from(value, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
module.exports = { hash, encrypt, decrypt };
