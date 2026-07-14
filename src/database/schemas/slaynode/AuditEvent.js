const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    eventId: { type: String, unique: true, required: true },
    actorType: String,
    actorId: String,
    guildId: String,
    nodeId: String,
    action: { type: String, required: true },
    category: String,
    bytes: Number,
    outcome: String,
    metadata: mongoose.Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.AuditEvent || mongoose.model("AuditEvent", schema);
