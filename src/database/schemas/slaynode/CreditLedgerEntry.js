const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    entryId: { type: String, unique: true, required: true },
    guildId: { type: String, required: true, index: true },
    nodeId: String,
    jobId: { type: String, unique: true, sparse: true },
    amountMicros: { type: Number, required: true, min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    reason: { type: String, required: true },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
module.exports = mongoose.models.CreditLedgerEntry || mongoose.model("CreditLedgerEntry", schema);
