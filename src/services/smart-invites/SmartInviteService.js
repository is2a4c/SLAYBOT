const crypto = require("crypto");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const SmartInvite = require("@schemas/SmartInvite");
const SmartInviteControl = require("@schemas/SmartInviteControl");
const inviteHandler = require("@handlers/invite");
const SmartInviteError = require("./SmartInviteError");
const { assertSlugAllowed, normalizeSlug } = require("./SmartInviteSlug");
const { buildSmartInviteAuditReason } = require("./SmartInviteAuditReason");
const { DEFAULT_DESCRIPTION } = require("./constants");
const { publicInviteURL } = require("./config");

const SUPPORTED_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);
const CONFIRMED_INVALID_CODES = new Set([10003, 10004, 10006, 50001]);
const SAFE_INVITE_CODE = /^[A-Za-z0-9_-]{2,32}$/;

class SmartInviteService {
  constructor(client, options = {}) {
    this.client = client;
    this.model = options.model || SmartInvite;
    this.controlModel = options.controlModel || SmartInviteControl;
    this.config = options.config || client.config.SMART_INVITES;
    this.logger = options.logger || client.logger;
    this.now = options.now || (() => new Date());
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.instanceId = options.instanceId || `${process.pid}-${crypto.randomUUID()}`;
  }

  assertEnabled() {
    if (!this.config.enabled) {
      throw new SmartInviteError("FEATURE_DISABLED", "Smart Invites сейчас отключены.");
    }
  }

  normalizeDescription(description) {
    if (description == null || String(description).trim() === "") return null;
    const value = String(description).normalize("NFC").trim();
    if (value.length > 200) {
      throw new SmartInviteError("DESCRIPTION_TOO_LONG", "Описание не может быть длиннее 200 символов.");
    }
    if (
      [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 127 && code <= 159);
      })
    ) {
      throw new SmartInviteError("INVALID_DESCRIPTION", "Описание содержит недопустимые управляющие символы.");
    }
    return value;
  }

  async getControl() {
    return this.controlModel
      .findById("global")
      .lean()
      .catch(() => null);
  }

  async isGuildBlocked(guildId) {
    if ((this.config.blockedGuildIds || []).includes(guildId)) return true;
    const control = await this.getControl();
    return Boolean(control?.blockedGuildIds?.includes(guildId));
  }

  async runtimeReservedSlugs() {
    const control = await this.getControl();
    return control?.reservedSlugs || [];
  }

  async assertGuildAllowed(guildId) {
    if (await this.isGuildBlocked(guildId)) {
      throw new SmartInviteError("GUILD_BLOCKED", "Для этого сервера Smart Invites заблокированы.");
    }
  }

  async validateRequestedSlug(slug, guildId, encodedPath = false) {
    return assertSlugAllowed(slug, this.config, {
      guildId,
      encodedPath,
      runtimeReserved: await this.runtimeReservedSlugs(),
    });
  }

  async pruneExpiredAliases(normalizedSlug) {
    const now = this.now();
    const query = normalizedSlug
      ? {
          $or: [
            {
              aliases: {
                $elemMatch: { normalizedSlug, expiresAt: { $lte: now } },
              },
            },
            {
              slugClaims: {
                $elemMatch: { normalizedSlug, expiresAt: { $lte: now } },
              },
            },
          ],
        }
      : {
          $or: [{ "aliases.expiresAt": { $lte: now } }, { "slugClaims.expiresAt": { $lte: now } }],
        };
    await this.model.updateMany(query, {
      $pull: {
        aliases: { expiresAt: { $lte: now } },
        slugClaims: { expiresAt: { $ne: null, $lte: now } },
      },
    });
  }

  async findBySlug(slug, options = {}) {
    const normalized = normalizeSlug(slug, { encodedPath: Boolean(options.encodedPath) });
    const now = this.now();
    const record = await this.model.findOne({
      $or: [
        { normalizedSlug: normalized, claimActive: true },
        {
          aliases: {
            $elemMatch: { normalizedSlug: normalized, expiresAt: { $gt: now } },
          },
        },
      ],
    });
    if (!record) return null;
    const alias = record.aliases?.find((item) => item.normalizedSlug === normalized && new Date(item.expiresAt) > now);
    return { record, normalizedSlug: normalized, alias: alias || null };
  }

  async assertSlugAvailable(normalizedSlug) {
    await this.pruneExpiredAliases(normalizedSlug);
    const now = this.now();
    const existing = await this.model.findOne({
      $or: [
        { normalizedSlug },
        {
          aliases: {
            $elemMatch: { normalizedSlug, expiresAt: { $gt: now } },
          },
        },
      ],
    });
    if (!existing) return;

    if (
      existing.normalizedSlug === normalizedSlug &&
      existing.status === "deleted" &&
      existing.reservedUntil &&
      existing.reservedUntil <= now
    ) {
      await this.model.updateOne(
        { _id: existing._id, status: "deleted", reservedUntil: { $lte: now } },
        {
          $set: { claimActive: false },
          $pull: { slugClaims: { normalizedSlug } },
        }
      );
      return;
    }
    if (existing.status === "deleted") {
      throw new SmartInviteError("SLUG_RETAINED", "Этот адрес временно удерживается после удаления.");
    }
    throw new SmartInviteError("SLUG_TAKEN", "Этот адрес уже используется.");
  }

  getGuild(guildId) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild || !guild.available) {
      throw new SmartInviteError("GUILD_UNAVAILABLE", "Discord-сервер временно недоступен.", {
        temporary: true,
      });
    }
    return guild;
  }

  async getChannel(guild, channelId) {
    const cached = guild.channels.cache.get(channelId);
    let channel = cached;
    if (!channel) {
      try {
        channel = await guild.channels.fetch(channelId);
      } catch (error) {
        const code = error?.code ?? error?.rawError?.code;
        if (!CONFIRMED_INVALID_CODES.has(code) && error?.status !== 404) {
          throw new SmartInviteError("DISCORD_TEMPORARY_ERROR", "Discord API временно недоступен. Попробуйте позже.", {
            temporary: true,
            cause: error,
            httpStatus: 503,
          });
        }
      }
    }
    if (!channel) {
      throw new SmartInviteError("CHANNEL_UNAVAILABLE", "Канал приглашения удалён или недоступен.", {
        confirmedInvalid: true,
      });
    }
    if (!SUPPORTED_CHANNEL_TYPES.has(channel.type) || (!channel.isTextBased?.() && !channel.isVoiceBased?.())) {
      throw new SmartInviteError("UNSUPPORTED_CHANNEL", "Выбранный тип канала не поддерживается.");
    }
    const permissions = channel.permissionsFor(guild.members.me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) {
      throw new SmartInviteError("MISSING_VIEW_CHANNEL", "У бота нет права View Channel в выбранном канале.");
    }
    if (!permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
      throw new SmartInviteError("MISSING_CREATE_INVITE", "У бота нет права Create Instant Invite в выбранном канале.");
    }
    return channel;
  }

  async createDiscordInvite(guild, channel, action, slug, actor) {
    const invite = await guild.invites.create(channel.id, {
      maxAge: 0,
      maxUses: 0,
      temporary: false,
      unique: true,
      reason: buildSmartInviteAuditReason({ action, slug, actor }),
    });
    if (!SAFE_INVITE_CODE.test(invite.code)) {
      await invite.delete("SLAYBOT Smart Invites: rejected unsafe invite code").catch(() => {});
      throw new SmartInviteError("INVALID_INVITE_CODE", "Discord вернул некорректный код приглашения.");
    }
    this.syncInviteCache(guild, invite);
    return invite;
  }

  syncInviteCache(guild, invite) {
    const cache = inviteHandler.getInviteCache(guild);
    if (cache) cache.set(invite.code, inviteHandler.cacheInvite(invite, false));
  }

  markInviteDeletedInCache(guild, code) {
    const cache = inviteHandler.getInviteCache(guild);
    if (cache?.has(code)) cache.get(code).deletedTimestamp = Date.now();
  }

  async create({ guildId, channelId, slug, description, actor }) {
    this.assertEnabled();
    await this.assertGuildAllowed(guildId);
    const normalizedSlug = await this.validateRequestedSlug(slug, guildId);
    await this.assertSlugAvailable(normalizedSlug);

    const activeCount = await this.model.countDocuments({
      guildId,
      status: { $in: ["active", "degraded"] },
      claimActive: true,
    });
    if (activeCount >= this.config.maxPerGuild) {
      throw new SmartInviteError("GUILD_LIMIT", `Достигнут лимит: ${this.config.maxPerGuild} ссылок.`);
    }

    const guild = this.getGuild(guildId);
    const channel = await this.getChannel(guild, channelId);
    const safeDescription = this.normalizeDescription(description);
    const invite = await this.createDiscordInvite(guild, channel, "create", normalizedSlug, actor);

    try {
      const record = await this.model.create({
        slug: normalizedSlug,
        normalizedSlug,
        guildId,
        channelId,
        createdBy: actor.id,
        description: safeDescription,
        discordInviteCode: invite.code,
        slugClaims: [{ normalizedSlug, expiresAt: null }],
        lastValidatedAt: this.now(),
        lastSuccessfulValidationAt: this.now(),
      });
      this.audit("smart_invite_created", record, { operation: "create" });
      return record;
    } catch (error) {
      await invite.delete("SLAYBOT Smart Invites: database creation failed").catch(() => {});
      if (error?.code === 11000) {
        throw new SmartInviteError("SLUG_TAKEN", "Этот адрес уже используется.", { cause: error });
      }
      throw error;
    }
  }

  async validateRecord(record) {
    const now = this.now();
    let guild;
    let channel;
    try {
      guild = this.getGuild(record.guildId);
      channel = await this.getChannel(guild, record.channelId);
    } catch (error) {
      await this.recordFailure(record._id, error.code || "VALIDATION_FAILED", Boolean(error.temporary));
      throw error;
    }

    try {
      const invite = await this.client.fetchInvite(record.discordInviteCode);
      const expired =
        (invite.expiresTimestamp && invite.expiresTimestamp <= now.getTime()) ||
        (invite.maxUses > 0 && invite.uses >= invite.maxUses);
      const mismatched = invite.guild?.id !== record.guildId || invite.channel?.id !== record.channelId;
      if (expired || mismatched) {
        throw new SmartInviteError("INVITE_INVALID", "Внутреннее приглашение Discord недействительно.", {
          confirmedInvalid: true,
        });
      }
      await this.model.updateOne(
        { _id: record._id },
        {
          $set: {
            status: "active",
            lastValidatedAt: now,
            lastSuccessfulValidationAt: now,
            validationFailureCount: 0,
          },
          $unset: { lastErrorCode: 1, lastErrorAt: 1, nextValidationAt: 1 },
        }
      );
      this.audit("smart_invite_validated", record, { operation: "validate" });
      return { valid: true, guild, channel, invite };
    } catch (error) {
      const code = error?.code ?? error?.rawError?.code;
      const confirmed = error.confirmedInvalid || CONFIRMED_INVALID_CODES.has(code) || error?.status === 404;
      if (confirmed) {
        await this.recordFailure(record._id, "INVITE_INVALID");
        return { valid: false, confirmedInvalid: true, guild, channel };
      }
      await this.recordFailure(record._id, "DISCORD_TEMPORARY_ERROR", true);
      throw new SmartInviteError("DISCORD_TEMPORARY_ERROR", "Discord API временно недоступен. Попробуйте позже.", {
        temporary: true,
        cause: error,
        httpStatus: 503,
      });
    }
  }

  async ensureUsable(record, options = {}) {
    if (record.status !== "active" && record.status !== "degraded") {
      throw this.statusError(record.status);
    }
    await this.assertGuildAllowed(record.guildId);
    const lastValidated = record.lastValidatedAt?.getTime?.() || 0;
    if (!options.force && Date.now() - lastValidated < this.config.validationTtlMs) {
      try {
        const guild = this.getGuild(record.guildId);
        const channel = await this.getChannel(guild, record.channelId);
        return { record, guild, channel, regenerated: false };
      } catch (error) {
        await this.recordFailure(record._id, error.code || "VALIDATION_FAILED", Boolean(error.temporary));
        throw error;
      }
    }

    const result = await this.validateRecord(record);
    if (result.valid) return { record, guild: result.guild, channel: result.channel, regenerated: false };
    const regenerated = await this.regenerate(record, { action: "regenerate" });
    return {
      record: regenerated,
      guild: this.getGuild(regenerated.guildId),
      channel: await this.getChannel(this.getGuild(regenerated.guildId), regenerated.channelId),
      regenerated: true,
    };
  }

  async acquireLease(recordId, expectedInviteCode) {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.config.regenerationLeaseMs);
    const record = await this.model.findOneAndUpdate(
      {
        _id: recordId,
        ...(expectedInviteCode ? { discordInviteCode: expectedInviteCode } : {}),
        $or: [
          { regenerationLock: null },
          { "regenerationLock.expiresAt": { $lte: now } },
          { "regenerationLock.expiresAt": { $exists: false } },
        ],
      },
      {
        $set: {
          regenerationLock: {
            ownerId: this.instanceId,
            acquiredAt: now,
            expiresAt,
          },
        },
      },
      { new: true }
    );
    if (record) this.audit("smart_invite_lock_acquired", record, { operation: "lock" });
    return record;
  }

  async releaseLease(recordId) {
    await this.model.updateOne(
      { _id: recordId, "regenerationLock.ownerId": this.instanceId },
      { $set: { regenerationLock: null } }
    );
  }

  async regenerate(record, options = {}) {
    const leased = await this.acquireLease(record._id, record.discordInviteCode);
    if (!leased) {
      const waited = await this.waitForRegeneration(record._id, record.discordInviteCode);
      if (waited) return waited;
      throw new SmartInviteError("REGENERATION_IN_PROGRESS", "Приглашение сейчас восстанавливается.", {
        temporary: true,
        httpStatus: 503,
      });
    }

    let newInvite;
    try {
      const guild = this.getGuild(leased.guildId);
      const channel = await this.getChannel(guild, options.channelId || leased.channelId);
      const action = options.action || "regenerate";
      newInvite = await this.createDiscordInvite(guild, channel, action, leased.slug, options.actor);
      const now = this.now();
      const update = {
        discordInviteCode: newInvite.code,
        channelId: channel.id,
        status: "active",
        lastValidatedAt: now,
        lastSuccessfulValidationAt: now,
        lastRegeneratedAt: now,
        regenerationLock: null,
        validationFailureCount: 0,
      };
      const increments = action === "regenerate" ? { regenerationCount: 1 } : { manualRefreshCount: 1 };
      const updated = await this.model.findOneAndUpdate(
        {
          _id: leased._id,
          "regenerationLock.ownerId": this.instanceId,
          "regenerationLock.expiresAt": { $gt: now },
        },
        {
          $set: update,
          $unset: { lastErrorCode: 1, lastErrorAt: 1, nextValidationAt: 1 },
          $inc: increments,
        },
        { new: true }
      );
      if (!updated) {
        await newInvite.delete("SLAYBOT Smart Invites: regeneration lease expired").catch(() => {});
        throw new SmartInviteError("LEASE_EXPIRED", "Восстановление не завершено: срок блокировки истёк.", {
          temporary: true,
        });
      }

      if (leased.discordInviteCode !== newInvite.code) {
        const oldInvite = await this.client.fetchInvite(leased.discordInviteCode).catch(() => null);
        await oldInvite?.delete("SLAYBOT Smart Invites: replaced internal invite").catch(() => {});
        this.markInviteDeletedInCache(guild, leased.discordInviteCode);
      }
      this.audit(action === "regenerate" ? "smart_invite_regenerated" : "smart_invite_updated", updated, {
        operation: action,
      });
      return updated;
    } catch (error) {
      if (newInvite) await newInvite.delete("SLAYBOT Smart Invites: regeneration failed").catch(() => {});
      await this.recordFailure(leased._id, error.code || "REGENERATION_FAILED", Boolean(error.temporary));
      await this.releaseLease(leased._id);
      this.audit("smart_invite_regeneration_failed", leased, {
        operation: options.action || "regenerate",
        errorCode: error.code || "REGENERATION_FAILED",
      });
      throw error;
    }
  }

  async waitForRegeneration(recordId, oldCode) {
    const deadline = Date.now() + Math.min(this.config.regenerationLeaseMs, 5000);
    while (Date.now() < deadline) {
      await this.sleep(100);
      const current = await this.model.findById(recordId);
      if (!current) return null;
      if (!current.regenerationLock && current.discordInviteCode !== oldCode) return current;
      if (current.regenerationLock?.expiresAt <= this.now()) return null;
    }
    return null;
  }

  async refresh(guildId, slug, actor) {
    const found = await this.findOwned(guildId, slug);
    return this.regenerate(found.record, { action: "refresh", actor });
  }

  async setChannel(guildId, slug, channelId, actor) {
    const found = await this.findOwned(guildId, slug);
    return this.regenerate(found.record, { action: "set-channel", channelId, actor });
  }

  async setDescription(guildId, slug, description) {
    const found = await this.findOwned(guildId, slug);
    const value = this.normalizeDescription(description);
    const updated = await this.model.findByIdAndUpdate(
      found.record._id,
      { $set: { description: value } },
      { new: true }
    );
    this.audit("smart_invite_updated", updated, { operation: "set-description" });
    return updated;
  }

  async rename(guildId, slug, newSlug) {
    const found = await this.findOwned(guildId, slug);
    const normalized = await this.validateRequestedSlug(newSlug, guildId);
    await this.assertSlugAvailable(normalized);
    const now = this.now();
    const old = found.record.normalizedSlug;
    const aliasExpiresAt = new Date(now.getTime() + this.config.aliasRetentionMs);
    const claims = (found.record.slugClaims || [])
      .filter((claim) => claim.normalizedSlug !== old)
      .map((claim) => ({
        normalizedSlug: claim.normalizedSlug,
        expiresAt: claim.expiresAt || null,
      }));
    claims.push({ normalizedSlug: old, expiresAt: aliasExpiresAt }, { normalizedSlug: normalized, expiresAt: null });
    const updated = await this.model.findOneAndUpdate(
      { _id: found.record._id, normalizedSlug: old },
      {
        $set: { slug: normalized, normalizedSlug: normalized, slugClaims: claims },
        $push: {
          aliases: {
            slug: old,
            normalizedSlug: old,
            expiresAt: aliasExpiresAt,
          },
        },
      },
      { new: true }
    );
    if (!updated) throw new SmartInviteError("UPDATE_CONFLICT", "Ссылка была изменена другим процессом.");
    this.audit("smart_invite_updated", updated, { operation: "rename" });
    return updated;
  }

  async softDelete(guildId, slug) {
    const found = await this.findOwned(guildId, slug);
    const now = this.now();
    const retentionExpiresAt = new Date(now.getTime() + this.config.deletedSlugRetentionMs);
    const retainedClaims = [
      found.record.normalizedSlug,
      ...(found.record.aliases || []).map((alias) => alias.normalizedSlug),
    ].map((normalizedSlug) => ({
      normalizedSlug,
      expiresAt: retentionExpiresAt,
    }));
    const updated = await this.model.findOneAndUpdate(
      { _id: found.record._id, status: { $ne: "deleted" } },
      {
        $set: {
          status: "deleted",
          deletedAt: now,
          reservedUntil: retentionExpiresAt,
          slugClaims: retainedClaims,
          regenerationLock: null,
        },
      },
      { new: true }
    );
    const invite = await this.client.fetchInvite(found.record.discordInviteCode).catch(() => null);
    await invite?.delete("SLAYBOT Smart Invites: public link deleted").catch(() => {});
    this.audit("smart_invite_deleted", updated || found.record, { operation: "delete" });
    return updated || found.record;
  }

  async findOwned(guildId, slug) {
    const found = await this.findBySlug(slug);
    if (!found || found.record.guildId !== guildId || found.alias) {
      throw new SmartInviteError("NOT_FOUND", "Smart Invite не найден на этом сервере.", {
        httpStatus: 404,
      });
    }
    return found;
  }

  async listForGuild(guildId) {
    return this.model.find({ guildId, claimActive: true }).sort({ createdAt: -1 }).lean();
  }

  statusError(status) {
    if (status === "deleted") {
      return new SmartInviteError("LINK_DELETED", "Эта ссылка удалена.", { httpStatus: 404 });
    }
    return new SmartInviteError("LINK_DISABLED", "Эта ссылка отключена.", { httpStatus: 403 });
  }

  async recordFailure(recordId, code, temporary = false) {
    const now = this.now();
    const record = await this.model.findById(recordId).select("validationFailureCount");
    const failureCount = (record?.validationFailureCount || 0) + 1;
    const backoffMs = Math.min(
      this.config.healthCheckIntervalMs,
      this.config.validationTtlMs * 2 ** Math.min(failureCount - 1, 5)
    );
    await this.model.updateOne(
      { _id: recordId },
      {
        $set: {
          status: "degraded",
          lastValidatedAt: now,
          lastErrorCode: code,
          lastErrorAt: now,
          validationFailureCount: failureCount,
          ...(temporary ? { nextValidationAt: new Date(now.getTime() + backoffMs) } : {}),
        },
        ...(!temporary ? { $unset: { nextValidationAt: 1 } } : {}),
      }
    );
  }

  async incrementStats(recordId, increments) {
    const safe = {};
    for (const [key, value] of Object.entries(increments)) {
      if (
        [
          "clickCount",
          "successfulPreviewCount",
          "successfulRedirectCount",
          "joinButtonClickCount",
          "failedRedirectCount",
        ].includes(key) &&
        Number.isInteger(value)
      ) {
        safe[key] = value;
      }
    }
    if (Object.keys(safe).length) await this.model.updateOne({ _id: recordId }, { $inc: safe });
  }

  async handleInviteDeleted(invite) {
    if (!invite?.code) return;
    const record = await this.model.findOne({
      discordInviteCode: invite.code,
      status: { $in: ["active", "degraded"] },
    });
    if (!record) return;
    await this.recordFailure(record._id, "INVITE_DELETED");
    this.regenerate(record, { action: "regenerate" }).catch(() => {});
  }

  async handleChannelDeleted(channel) {
    if (!channel?.id || !channel.guild?.id) return;
    await this.model.updateMany(
      {
        guildId: channel.guild.id,
        channelId: channel.id,
        status: { $in: ["active", "degraded"] },
      },
      {
        $set: {
          status: "degraded",
          lastErrorCode: "CHANNEL_UNAVAILABLE",
          lastErrorAt: this.now(),
        },
      }
    );
  }

  async handleGuildDeleted(guildId) {
    const now = this.now();
    const result = await this.model.updateMany(
      { guildId, status: { $in: ["active", "degraded"] } },
      {
        $set: {
          status: "disabled",
          lastErrorCode: "BOT_REMOVED",
          lastErrorAt: now,
        },
      }
    );
    if (result.modifiedCount) {
      this.logger.log(JSON.stringify({ event: "smart_invite_disabled", guildId, count: result.modifiedCount }));
    }
  }

  async disableLink(slug) {
    const found = await this.findBySlug(slug);
    if (!found) throw new SmartInviteError("NOT_FOUND", "Smart Invite не найден.", { httpStatus: 404 });
    found.record.status = "disabled";
    found.record.lastErrorCode = "OWNER_DISABLED";
    found.record.lastErrorAt = this.now();
    await found.record.save();
    this.audit("smart_invite_disabled", found.record, { operation: "owner-disable" });
    return found.record;
  }

  async setGuildBlocked(guildId, blocked) {
    const operation = blocked ? "$addToSet" : "$pull";
    await this.controlModel.findByIdAndUpdate(
      "global",
      { [operation]: { blockedGuildIds: guildId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (blocked) await this.handleGuildDeleted(guildId);
  }

  async reserveSlug(slug) {
    const normalized = normalizeSlug(slug);
    await this.assertSlugAvailable(normalized);
    await this.controlModel.findByIdAndUpdate(
      "global",
      { $addToSet: { reservedSlugs: normalized } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return normalized;
  }

  async forceUnlock(slug) {
    const found = await this.findBySlug(slug);
    if (!found) throw new SmartInviteError("NOT_FOUND", "Smart Invite не найден.", { httpStatus: 404 });
    found.record.regenerationLock = null;
    await found.record.save();
    return found.record;
  }

  async recoverExpiredLeases() {
    const now = this.now();
    const expired = await this.model.find({
      "regenerationLock.expiresAt": { $lte: now },
    });
    if (!expired.length) return 0;
    await this.model.updateMany({ "regenerationLock.expiresAt": { $lte: now } }, { $set: { regenerationLock: null } });
    for (const record of expired) {
      this.audit("smart_invite_lock_expired", record, { operation: "startup-recovery" });
    }
    return expired.length;
  }

  getPublicURL(record) {
    return publicInviteURL(this.config, record.slug);
  }

  getPublicDescription(record) {
    return record.description || DEFAULT_DESCRIPTION;
  }

  audit(event, record, details = {}) {
    const payload = {
      event,
      smartInviteId: String(record?._id || ""),
      guildId: record?.guildId,
      slug: record?.normalizedSlug,
      operation: details.operation,
      errorCode: details.errorCode,
    };
    this.logger.log(JSON.stringify(payload));
  }
}

module.exports = {
  SmartInviteService,
  SUPPORTED_CHANNEL_TYPES,
  SAFE_INVITE_CODE,
  CONFIRMED_INVALID_CODES,
};
