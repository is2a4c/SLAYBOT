const mongoose = require("mongoose");

const SmartInviteControlSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "global" },
    blockedGuildIds: { type: [String], default: [] },
    reservedSlugs: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SmartInviteControl ||
  mongoose.model("SmartInviteControl", SmartInviteControlSchema, "smart_invite_controls");
