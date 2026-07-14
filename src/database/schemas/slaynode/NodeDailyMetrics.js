const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  nodeId: { type: String, required: true },
  guildId: String,
  day: { type: Date, required: true },
  uptimeSeconds: { type: Number, default: 0 },
  accepted: { type: Number, default: 0 },
  rejected: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  canaryPassed: { type: Number, default: 0 },
  latencyTotalMs: { type: Number, default: 0 },
  computeMs: { type: Number, default: 0 },
});
schema.index({ nodeId: 1, day: 1 }, { unique: true });
module.exports = mongoose.models.NodeDailyMetrics || mongoose.model("NodeDailyMetrics", schema);
