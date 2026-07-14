const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    tokenHash: { type: String, unique: true, required: true },
    ownerId: { type: String, required: true },
    guildId: String,
    name: String,
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.models.NodeEnrollment || mongoose.model("NodeEnrollment", schema);
