const mongoose = require("mongoose");

// Stage 1 keeps roles fixed (see src/services/dashboard/permissions.js ROLE_PRESETS)
// rather than a free-form role builder - that CRUD belongs to a later stage.
const STAFF_ROLES = ["moderator", "admin"];

const Schema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // Discord user id
    role: { type: String, required: true, enum: STAFF_ROLES },
    addedBy: { type: String, required: true },
  },
  {
    versionKey: false,
    timestamps: { createdAt: "added_at", updatedAt: "updated_at" },
  }
);

const Model = mongoose.models["staff-accounts"] || mongoose.model("staff-accounts", Schema, "staff_accounts");

module.exports = {
  model: Model,
  STAFF_ROLES,

  getStaffAccount: (discordId) => Model.findById(discordId).lean(),
  listStaffAccounts: () => Model.find().sort({ added_at: -1 }).lean(),

  upsertStaffAccount: (discordId, role, addedBy) =>
    Model.findByIdAndUpdate(
      discordId,
      { _id: discordId, role, addedBy },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ),

  removeStaffAccount: (discordId) => Model.findByIdAndDelete(discordId),
};
