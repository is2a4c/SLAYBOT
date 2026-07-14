const crypto = require("crypto");
const { sign } = require("../protocol/auth");

class ControlClient {
  constructor({ baseUrl, nodeId, secret, timeoutMs = 65_000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.nodeId = nodeId;
    this.secret = secret;
    this.timeoutMs = timeoutMs;
  }
  async request(path, body = {}) {
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(16).toString("hex");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-slay-node-id": this.nodeId,
          "x-slay-timestamp": String(timestamp),
          "x-slay-nonce": nonce,
          "x-slay-signature": sign(this.secret, "POST", path, timestamp, nonce, body),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  heartbeat(load) {
    return this.request("/v1/node/heartbeat", { load });
  }
  lease() {
    return this.request("/v1/node/lease");
  }
  ack(leaseId, result, executionMs) {
    return this.request("/v1/node/ack", { leaseId, result, executionMs });
  }
  nack(leaseId, errorCode) {
    return this.request("/v1/node/nack", { leaseId, errorCode });
  }
}
module.exports = ControlClient;
