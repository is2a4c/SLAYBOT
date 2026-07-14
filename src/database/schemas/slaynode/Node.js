const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    nodeId: { type: String, unique: true, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 64 },
    guildIds: [{ type: String, index: true }],
    credentialHash: { type: String, required: true, select: false },
    credentialEncrypted: { type: String, select: false },
    status: { type: String, enum: ["ONLINE", "OFFLINE", "DEGRADED", "REVOKED"], default: "OFFLINE" },
    trustedCentral: { type: Boolean, default: false },
    protocolVersions: { type: [String], default: ["1.0"] },
    workerVersion: String,
    workerDigest: String,
    capabilities: { type: [String], default: [] },
    privacyClasses: { type: [String], default: ["PUBLIC", "ANONYMIZED"] },
    resources: { cpu: Number, ramMb: Number, gpu: Boolean, parallelism: Number },
    limits: { cpu: Number, ramMb: Number, gpu: Boolean, parallelism: Number },
    load: { running: Number, cpu: Number, ramMb: Number },
    schedule: { enabled: { type: Boolean, default: false }, startHourUtc: Number, endHourUtc: Number },
    lastHeartbeatAt: Date,
    latencyMs: { type: Number, default: 0 },
    reliability: { type: Number, default: 1 },
    cooldownUntil: Date,
    revokedAt: Date,
    credentialVersion: { type: Number, default: 1 },
    lastNonces: { type: [String], select: false, default: [] },
  },
  { timestamps: true, minimize: false }
);
schema.index({ status: 1, cooldownUntil: 1, reliability: -1 });
module.exports = mongoose.models.SlayNode || mongoose.model("SlayNode", schema);
