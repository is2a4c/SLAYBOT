const mongoose = require("mongoose");

const AliasSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    normalizedSlug: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false }
);

const RegenerationLockSchema = new mongoose.Schema(
  {
    ownerId: String,
    acquiredAt: Date,
    expiresAt: Date,
  },
  { _id: false }
);

const SlugClaimSchema = new mongoose.Schema(
  {
    normalizedSlug: { type: String, required: true },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const SmartInviteSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, trim: true },
    normalizedSlug: { type: String, required: true, trim: true },
    claimActive: { type: Boolean, default: true },
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    createdBy: { type: String, required: true },
    description: { type: String, default: null, maxlength: 200 },
    discordInviteCode: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "degraded", "disabled", "deleted"],
      default: "active",
      index: true,
    },
    clickCount: { type: Number, default: 0, min: 0 },
    successfulPreviewCount: { type: Number, default: 0, min: 0 },
    successfulRedirectCount: { type: Number, default: 0, min: 0 },
    joinButtonClickCount: { type: Number, default: 0, min: 0 },
    failedRedirectCount: { type: Number, default: 0, min: 0 },
    regenerationCount: { type: Number, default: 0, min: 0 },
    manualRefreshCount: { type: Number, default: 0, min: 0 },
    lastValidatedAt: Date,
    lastSuccessfulValidationAt: Date,
    lastRegeneratedAt: Date,
    lastErrorCode: String,
    lastErrorAt: Date,
    deletedAt: Date,
    reservedUntil: Date,
    aliases: { type: [AliasSchema], default: [] },
    slugClaims: { type: [SlugClaimSchema], required: true },
    regenerationLock: { type: RegenerationLockSchema, default: null },
    validationFailureCount: { type: Number, default: 0, min: 0 },
    nextValidationAt: Date,
    schemaVersion: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

SmartInviteSchema.index({ normalizedSlug: 1 }, { unique: true, partialFilterExpression: { claimActive: true } });
SmartInviteSchema.index({ "slugClaims.normalizedSlug": 1 }, { unique: true, sparse: true });
SmartInviteSchema.index({ status: 1, lastValidatedAt: 1 });
SmartInviteSchema.index({ status: 1, nextValidationAt: 1 });
SmartInviteSchema.index({ "aliases.expiresAt": 1 });
SmartInviteSchema.index({ "regenerationLock.expiresAt": 1 });
SmartInviteSchema.index({ guildId: 1, status: 1 });

module.exports = mongoose.models.SmartInvite || mongoose.model("SmartInvite", SmartInviteSchema, "smart_invites");
