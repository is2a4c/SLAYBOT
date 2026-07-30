const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    actorId: { type: String, required: true },
    actorTag: { type: String, required: true },
    action: { type: String, required: true },
    guildId: { type: String, default: null, index: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
  },
  {
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: false },
  }
);

Schema.index({ guildId: 1, created_at: -1 });
Schema.index({ created_at: -1 });

// Append-only: no update/delete helpers are exported on purpose. Dashboard-audit
// entries must never be editable from the UI.
module.exports =
  mongoose.models["dashboard-audit-logs"] || mongoose.model("dashboard-audit-logs", Schema, "dashboard_audit_logs");
