const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, index: true },
    leaseId: { type: String, unique: true, required: true },
    nodeId: { type: String, required: true, index: true },
    status: { type: String, enum: ["LEASED", "ACKED", "NACKED", "EXPIRED", "REJECTED"], default: "LEASED" },
    startedAt: Date,
    finishedAt: Date,
    latencyMs: Number,
    errorCode: String,
  },
  { timestamps: true }
);
module.exports = mongoose.models.ComputeJobAttempt || mongoose.model("ComputeJobAttempt", schema);
