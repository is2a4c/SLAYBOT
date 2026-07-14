const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    guildId: { type: String, unique: true, required: true },
    tier: { type: String, enum: ["Bronze", "Silver", "Gold", "Platinum"], default: "Bronze" },
    cachedBalanceMicros: { type: Number, default: 0, min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
    tierScore: { type: Number, default: 0 },
    tierCalculatedAt: Date,
  },
  { timestamps: true }
);
module.exports = mongoose.models.GuildPartnerAccount || mongoose.model("GuildPartnerAccount", schema);
