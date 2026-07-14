const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    jobId: { type: String, unique: true, required: true },
    idempotencyKey: { type: String, unique: true, sparse: true },
    protocolVersion: { type: String, required: true },
    type: { type: String, required: true, index: true },
    privacyClass: { type: String, required: true, index: true },
    guildId: { type: String, index: true },
    targetNodeId: { type: String, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, select: false },
    payloadBytes: Number,
    payloadDigest: String,
    status: {
      type: String,
      enum: ["QUEUED", "LEASED", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"],
      default: "QUEUED",
      index: true,
    },
    priority: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    nextAttemptAt: { type: Date, default: Date.now },
    leasedTo: String,
    leaseId: String,
    leaseExpiresAt: Date,
    deadlineAt: Date,
    result: mongoose.Schema.Types.Mixed,
    resultDigest: String,
    acceptedAt: Date,
    errorCode: String,
    deletePayloadAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    canary: { type: Boolean, default: false },
    expectedDigest: String,
  },
  { timestamps: true }
);
schema.index({ status: 1, nextAttemptAt: 1, priority: -1, createdAt: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.ComputeJob || mongoose.model("ComputeJob", schema);
