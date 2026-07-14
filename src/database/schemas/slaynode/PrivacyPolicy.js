const mongoose = require("mongoose");
const schema = new mongoose.Schema(
  {
    guildId: { type: String, unique: true, required: true },
    allowGuildPrivate: { type: Boolean, default: false },
    allowedJobTypes: {
      type: [String],
      default: ["image.prepare.v1", "image.ocr.v1", "image.vision.v1", "image.spam.v1"],
    },
    allowGeneralPool: { type: Boolean, default: false },
    updatedBy: String,
  },
  { timestamps: true }
);
module.exports = mongoose.models.PrivacyPolicy || mongoose.model("PrivacyPolicy", schema);
