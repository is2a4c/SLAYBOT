require("module-alias/register");

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { ChannelType, Collection, PermissionFlagsBits } = require("discord.js");
const SmartInvite = require("../src/database/schemas/SmartInvite");
const SmartInviteControl = require("../src/database/schemas/SmartInviteControl");
const { normalizeSlug, assertSlugAllowed } = require("../src/services/smart-invites/SmartInviteSlug");
const {
  buildSmartInviteAuditReason,
  MAX_REASON_LENGTH,
} = require("../src/services/smart-invites/SmartInviteAuditReason");
const { normalizeBaseURL, validateSmartInviteConfiguration } = require("../src/services/smart-invites/config");
const { SmartInviteService } = require("../src/services/smart-invites/SmartInviteService");
const SmartInviteScheduler = require("../src/services/smart-invites/SmartInviteScheduler");
const { createSmartInvitesApp, discordURL, safeSupportURL } = require("../src/web/smart-invites/app");
const { escapeHtml } = require("../src/web/smart-invites/templates");
const runtime = require("../src/services/smart-invites/runtime");
const inviteHandler = require("../src/handlers/invite");
const { applySmartInviteEnvironment } = require("../src/helpers/ConfigDefaults");

const baseConfig = {
  enabled: true,
  baseURL: "https://slaybot.televibe.host",
  pathPrefix: "",
  host: "127.0.0.1",
  port: 8081,
  maxPerGuild: 5,
  validationTtlMs: 300000,
  healthCheckIntervalMs: 900000,
  regenerationLeaseMs: 15000,
  deletedSlugRetentionMs: 2592000000,
  aliasRetentionMs: 2592000000,
  backgroundChecks: true,
  redirectMode: "preview",
  officialGuildId: "999999999999999999",
  officialSlug: "slaybot",
  reservedSlugs: ["custom-reserved"],
  blockedGuildIds: [],
  trustProxy: false,
  commandCooldownSeconds: 5,
  publicRateLimitWindowMs: 60000,
  publicRateLimitMax: 120,
  backgroundConcurrency: 2,
};

let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([SmartInvite.syncIndexes(), SmartInviteControl.syncIndexes()]);
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all([SmartInvite.deleteMany({}), SmartInviteControl.deleteMany({})]);
});

test("normalizes valid slugs and rejects ambiguous or malformed values", () => {
  assert.equal(normalizeSlug("My-Server"), "my-server");
  for (const invalid of [
    "ab",
    "a".repeat(33),
    "-abc",
    "abc-",
    "two--dash",
    "with space",
    "точка",
    "a/b",
    "abc%252fdef",
    "ａｂｃ",
  ]) {
    assert.throws(() => normalizeSlug(invalid, { encodedPath: invalid.includes("%") }), {
      code: "INVALID_SLUG",
    });
  }
});

test("enforces core, configured and official reserved slugs", () => {
  assert.throws(() => assertSlugAllowed("admin", baseConfig, { guildId: "1" }), {
    code: "SLUG_RESERVED",
  });
  assert.throws(() => assertSlugAllowed("custom-reserved", baseConfig, { guildId: "1" }), {
    code: "SLUG_RESERVED",
  });
  assert.throws(() => assertSlugAllowed("slaybot", baseConfig, { guildId: "1" }), {
    code: "SLUG_RESERVED",
  });
  assert.equal(assertSlugAllowed("slaybot", baseConfig, { guildId: baseConfig.officialGuildId }), "slaybot");
});

test("builds sanitized bounded Discord Audit Log reasons", () => {
  const reason = buildSmartInviteAuditReason({
    action: "create",
    slug: "safe\u0000slug",
    actor: { id: "123", username: "admin\n<script>" },
  });
  assert.match(reason, /SLAYBOT Smart Invites/);
  assert.doesNotMatch(reason, /[\n<>]/);
  assert.ok(reason.length <= MAX_REASON_LENGTH);
  assert.match(buildSmartInviteAuditReason({ action: "regenerate", slug: "safe", actor: null }), /автоматически/);
});

test("validates and normalizes Smart Invites runtime configuration", () => {
  assert.equal(normalizeBaseURL("https://example.com/"), "https://example.com");
  assert.deepEqual(validateSmartInviteConfiguration(baseConfig, "production"), []);
  assert.ok(
    validateSmartInviteConfiguration(
      { ...baseConfig, baseURL: "http://public.example", redirectMode: "forever" },
      "production"
    ).length >= 2
  );
  assert.ok(validateSmartInviteConfiguration({ ...baseConfig, pathPrefix: "//evil/" }).length > 0);
});

test("applies explicit Smart Invites production environment overrides", () => {
  const previous = {
    enabled: process.env.SMART_INVITES_ENABLED,
    baseURL: process.env.SMART_INVITES_BASE_URL,
    host: process.env.SMART_INVITES_HOST,
    guildId: process.env.SMART_INVITES_OFFICIAL_GUILD_ID,
  };
  process.env.SMART_INVITES_ENABLED = "true";
  process.env.SMART_INVITES_BASE_URL = "https://slaybot.televibe.host";
  process.env.SMART_INVITES_HOST = "0.0.0.0";
  process.env.SMART_INVITES_OFFICIAL_GUILD_ID = "1229090248273957046";
  const config = { SMART_INVITES: { ...baseConfig, enabled: false, officialGuildId: "" } };
  applySmartInviteEnvironment(config);
  assert.equal(config.SMART_INVITES.enabled, true);
  assert.equal(config.SMART_INVITES.baseURL, "https://slaybot.televibe.host");
  assert.equal(config.SMART_INVITES.host, "0.0.0.0");
  assert.equal(config.SMART_INVITES.officialGuildId, "1229090248273957046");
  restoreEnvironment("SMART_INVITES_ENABLED", previous.enabled);
  restoreEnvironment("SMART_INVITES_BASE_URL", previous.baseURL);
  restoreEnvironment("SMART_INVITES_HOST", previous.host);
  restoreEnvironment("SMART_INVITES_OFFICIAL_GUILD_ID", previous.guildId);
});

test("creates a Smart Invite, saves description, audit reason and invite cache", async () => {
  const fixture = createFixture();
  inviteHandler.resetInviteCache(fixture.guild);
  const cache = new Collection();
  const originalCache = inviteHandler.getInviteCache;
  inviteHandler.getInviteCache = () => cache;
  try {
    const record = await fixture.service.create({
      guildId: fixture.guild.id,
      channelId: fixture.channel.id,
      slug: "my-server",
      description: "Официальный сервер",
      actor: fixture.actor,
    });
    assert.equal(record.description, "Официальный сервер");
    assert.equal(record.status, "active");
    assert.equal(fixture.created.length, 1);
    assert.match(fixture.created[0].options.reason, /my-server/);
    assert.equal(cache.has(record.discordInviteCode), true);
  } finally {
    inviteHandler.getInviteCache = originalCache;
  }
});

test("uses a safe standard description when none was saved", async () => {
  const fixture = createFixture();
  const record = await fixture.service.create({
    guildId: fixture.guild.id,
    channelId: fixture.channel.id,
    slug: "default-description",
    actor: fixture.actor,
  });
  assert.match(fixture.service.getPublicDescription(record), /Постоянная ссылка/);
});

test("enforces global slug uniqueness, immediate rename cleanup and per-guild limits", async () => {
  const fixture = createFixture({ maxPerGuild: 1 });
  await fixture.service.create({
    guildId: fixture.guild.id,
    channelId: fixture.channel.id,
    slug: "first-link",
    actor: fixture.actor,
  });
  await assert.rejects(
    fixture.service.create({
      guildId: fixture.guild.id,
      channelId: fixture.channel.id,
      slug: "second-link",
      actor: fixture.actor,
    }),
    { code: "GUILD_LIMIT" }
  );

  fixture.service.config.maxPerGuild = 5;
  await assert.rejects(
    fixture.service.create({
      guildId: fixture.guild.id,
      channelId: fixture.channel.id,
      slug: "first-link",
      actor: fixture.actor,
    }),
    { code: "SLUG_TAKEN" }
  );
  const renamed = await fixture.service.rename(fixture.guild.id, "first-link", "renamed-link");
  assert.equal(await fixture.service.findBySlug("first-link"), null);
  await fixture.service.assertSlugAvailable("first-link");
  assert.equal((await fixture.service.findBySlug("renamed-link")).record.id, renamed.id);
  assert.deepEqual(renamed.aliases, []);
  assert.deepEqual(
    renamed.slugClaims.map((claim) => claim.normalizedSlug),
    ["renamed-link"]
  );
});

test("validates a live Discord invite without creating another one", async () => {
  const fixture = createFixture();
  const record = await createRecord(fixture, "valid-link");
  record.lastValidatedAt = new Date(0);
  await record.save();
  const result = await fixture.service.ensureUsable(record);
  assert.equal(result.regenerated, false);
  assert.equal(fixture.created.length, 1);
});

test("regenerates a deleted or exhausted invite and keeps the public slug", async () => {
  for (const scenario of ["deleted", "exhausted"]) {
    await SmartInvite.deleteMany({});
    const fixture = createFixture();
    const record = await createRecord(fixture, `${scenario}-link`);
    record.lastValidatedAt = new Date(0);
    await record.save();
    if (scenario === "deleted") fixture.invites.delete(record.discordInviteCode);
    else {
      const invite = fixture.invites.get(record.discordInviteCode);
      invite.maxUses = 1;
      invite.uses = 1;
    }
    const result = await fixture.service.ensureUsable(record);
    assert.equal(result.regenerated, true);
    assert.equal(result.record.slug, `${scenario}-link`);
    assert.equal(result.record.regenerationCount, 1);
  }
});

test("marks deleted channels and missing permissions without regenerating", async () => {
  const fixture = createFixture();
  const record = await createRecord(fixture, "broken-channel");
  fixture.guild.channels.cache.delete(fixture.channel.id);
  fixture.guild.channels.fetch = async () => null;
  await assert.rejects(fixture.service.ensureUsable(record, { force: true }), {
    code: "CHANNEL_UNAVAILABLE",
  });
  assert.equal(fixture.created.length, 1);

  const permissionsFixture = createFixture({ denyPermission: PermissionFlagsBits.CreateInstantInvite });
  await assert.rejects(
    permissionsFixture.service.create({
      guildId: permissionsFixture.guild.id,
      channelId: permissionsFixture.channel.id,
      slug: "no-permission",
      actor: permissionsFixture.actor,
    }),
    { code: "MISSING_CREATE_INVITE" }
  );
});

test("uses one MongoDB lease for concurrent regeneration", async () => {
  const fixture = createFixture();
  const record = await createRecord(fixture, "race-link");
  fixture.invites.delete(record.discordInviteCode);
  record.lastValidatedAt = new Date(0);
  await record.save();
  const [first, second] = await Promise.all([
    fixture.service.ensureUsable(await SmartInvite.findById(record._id)),
    fixture.service.ensureUsable(await SmartInvite.findById(record._id)),
  ]);
  assert.equal(first.record.discordInviteCode, second.record.discordInviteCode);
  assert.equal(fixture.created.length, 2);
  assert.equal((await SmartInvite.findById(record._id)).regenerationCount, 1);
});

test("recovers expired leases and rejects writes after lease expiry", async () => {
  const fixture = createFixture({ regenerationLeaseMs: 10 });
  const record = await createRecord(fixture, "lease-link");
  record.regenerationLock = {
    ownerId: "dead-worker",
    acquiredAt: new Date(0),
    expiresAt: new Date(1),
  };
  await record.save();
  assert.equal(await fixture.service.recoverExpiredLeases(), 1);
  assert.equal((await SmartInvite.findById(record._id)).regenerationLock, null);

  let clock = new Date("2026-01-01T00:00:00Z");
  const fenced = createFixture({
    regenerationLeaseMs: 10,
    now: () => new Date(clock),
  });
  const fencedRecord = await createRecord(fenced, "fenced-link");
  fenced.service.createDiscordInvite = async (...args) => {
    const invite = await SmartInviteService.prototype.createDiscordInvite.call(fenced.service, ...args);
    clock = new Date(clock.getTime() + 20);
    return invite;
  };
  await assert.rejects(fenced.service.regenerate(fencedRecord, { action: "refresh", actor: fenced.actor }), {
    code: "LEASE_EXPIRED",
  });
});

test("soft deletion retains the current slug and guildDelete disables links", async () => {
  let clock = new Date("2026-01-01T00:00:00Z");
  const fixture = createFixture({
    deletedSlugRetentionMs: 1000,
    now: () => new Date(clock),
  });
  const record = await createRecord(fixture, "delete-link");
  await fixture.service.softDelete(fixture.guild.id, record.slug);
  await assert.rejects(fixture.service.assertSlugAvailable("delete-link"), { code: "SLUG_RETAINED" });
  clock = new Date(clock.getTime() + 1001);
  await fixture.service.assertSlugAvailable("delete-link");

  const other = await createRecord(fixture, "guild-left");
  await fixture.service.handleGuildDeleted(fixture.guild.id);
  assert.equal((await SmartInvite.findById(other._id)).status, "disabled");
});

test("startup cleanup removes aliases created by older rename behavior", async () => {
  const fixture = createFixture();
  const record = await createRecord(fixture, "current-link");
  record.aliases = [
    {
      slug: "legacy-link",
      normalizedSlug: "legacy-link",
      expiresAt: new Date(Date.now() + 60_000),
    },
  ];
  record.slugClaims.push({
    normalizedSlug: "legacy-link",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await record.save();

  assert.ok(await fixture.service.findBySlug("legacy-link"));
  assert.equal(await fixture.service.purgeLegacyRenameAliases(), 1);
  assert.equal(await fixture.service.findBySlug("legacy-link"), null);
  await fixture.service.assertSlugAvailable("legacy-link");
  const cleaned = await SmartInvite.findById(record._id);
  assert.deepEqual(cleaned.aliases, []);
  assert.deepEqual(
    cleaned.slugClaims.map((claim) => claim.normalizedSlug),
    ["current-link"]
  );
});

test("blocks configured or owner-blocked guilds and reserves owner slugs", async () => {
  const fixture = createFixture({ blockedGuildIds: [createFixture().guild.id] });
  await assert.rejects(
    fixture.service.create({
      guildId: fixture.guild.id,
      channelId: fixture.channel.id,
      slug: "blocked-link",
      actor: fixture.actor,
    }),
    { code: "GUILD_BLOCKED" }
  );

  const controlled = createFixture();
  await controlled.service.reserveSlug("owner-reserved");
  await assert.rejects(
    controlled.service.create({
      guildId: controlled.guild.id,
      channelId: controlled.channel.id,
      slug: "owner-reserved",
      actor: controlled.actor,
    }),
    { code: "SLUG_RESERVED" }
  );
  await controlled.service.setGuildBlocked(controlled.guild.id, true);
  assert.equal(await controlled.service.isGuildBlocked(controlled.guild.id), true);
  await controlled.service.setGuildBlocked(controlled.guild.id, false);
  assert.equal(await controlled.service.isGuildBlocked(controlled.guild.id), false);
});

test("renders secure preview, disabled and 404 pages without leaking the invite code", async () => {
  const fixture = createFixture();
  const record = await createRecord(fixture, "web-link", "<img src=x onerror=alert(1)>");
  const server = await listen(createSmartInvitesApp(fixture.service));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const preview = await fetch(`${base}/web-link`);
    const html = await preview.text();
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, new RegExp(record.discordInviteCode));
    const join = await fetch(`${base}/web-link/join`, { redirect: "manual" });
    assert.equal(join.status, 302);
    assert.equal(join.headers.get("location"), `https://discord.gg/${record.discordInviteCode}`);

    const missing = await fetch(`${base}/missing-link`);
    assert.equal(missing.status, 404);
    record.status = "disabled";
    await record.save();
    const disabled = await fetch(`${base}/web-link`);
    assert.equal(disabled.status, 403);
    assert.match(await disabled.text(), /Ссылка отключена/);
  } finally {
    await close(server);
  }
});

test("temporary Discord failures set exponential validation backoff", async () => {
  const fixture = createFixture();
  const record = await createRecord(fixture, "backoff-link");
  fixture.client.fetchInvite = async () => {
    throw new Error("network unavailable");
  };
  await assert.rejects(fixture.service.validateRecord(record), {
    code: "DISCORD_TEMPORARY_ERROR",
  });
  const first = await SmartInvite.findById(record._id);
  assert.equal(first.validationFailureCount, 1);
  assert.ok(first.nextValidationAt > first.lastValidatedAt);
  const firstDelay = first.nextValidationAt - first.lastValidatedAt;

  await assert.rejects(fixture.service.validateRecord(first), {
    code: "DISCORD_TEMPORARY_ERROR",
  });
  const second = await SmartInvite.findById(record._id);
  assert.equal(second.validationFailureCount, 2);
  assert.ok(second.nextValidationAt - second.lastValidatedAt >= firstDelay);
});

test("redirect mode uses temporary redirects and cannot become an open redirect", async () => {
  const fixture = createFixture({ redirectMode: "redirect" });
  const record = await createRecord(fixture, "redirect-link");
  const server = await listen(createSmartInvitesApp(fixture.service));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/redirect-link?next=https://evil.example`, {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), `https://discord.gg/${record.discordInviteCode}`);
    assert.throws(() => discordURL("https://evil.example"), { code: "INVALID_INVITE_CODE" });
    assert.equal(safeSupportURL("javascript:alert(1)"), null);
    assert.equal(safeSupportURL("https://evil.example/invite"), null);
    assert.match(safeSupportURL("https://discord.gg/SafeCode"), /^https:\/\/discord\.gg\//);
    const updated = await SmartInvite.findById(record._id);
    assert.equal(updated.clickCount, 1);
    assert.equal(updated.successfulRedirectCount, 1);
  } finally {
    await close(server);
  }
});

test("escapes all public HTML metacharacters", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
});

test("scheduler bounds concurrency and backs off by last validation time", async () => {
  let active = 0;
  let maximum = 0;
  const records = Array.from({ length: 6 }, (_, index) => ({ _id: index }));
  const service = {
    config: { ...baseConfig, backgroundConcurrency: 2 },
    pruneExpiredAliases: async () => {},
    model: {
      find: () => ({
        sort: () => ({
          limit: async () => records,
        }),
      }),
    },
    ensureUsable: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      throw new Error("temporary Discord error");
    },
  };
  const scheduler = new SmartInviteScheduler(service);
  scheduler.scheduleNext = () => {};
  await scheduler.tick();
  assert.equal(maximum, 2);
});

test("invite tracking cache synchronization does not count a technical invite as a join", () => {
  const fixture = createFixture();
  const cache = new Collection();
  const original = inviteHandler.getInviteCache;
  inviteHandler.getInviteCache = () => cache;
  try {
    const invite = { code: "Technical01", uses: 0, maxUses: 0, inviter: { id: "admin" } };
    fixture.service.syncInviteCache(fixture.guild, invite);
    assert.deepEqual(cache.get(invite.code), {
      code: invite.code,
      uses: 0,
      maxUses: 0,
      inviterId: "admin",
    });
  } finally {
    inviteHandler.getInviteCache = original;
  }
});

test("runtime stays disabled or starts once and shuts its HTTP server down", async () => {
  const disabled = createFixture({ enabled: false });
  assert.equal(await runtime.start(disabled.client), null);

  const enabled = createFixture({
    port: 0,
    backgroundChecks: false,
  });
  const started = await runtime.start(enabled.client);
  assert.ok(started.server.listening);
  assert.equal(await runtime.start(enabled.client), started);
  await runtime.stop(enabled.client);
  assert.equal(started.server.listening, false);
});

function createFixture(overrides = {}) {
  const config = { ...baseConfig, ...overrides };
  const invites = new Map();
  const created = [];
  let sequence = 0;
  const actor = { id: "111111111111111111", username: "Administrator" };
  const permissions = {
    has: (permission) => permission !== overrides.denyPermission,
  };
  const channel = {
    id: "222222222222222222",
    name: "general",
    type: ChannelType.GuildText,
    isTextBased: () => true,
    isVoiceBased: () => false,
    permissionsFor: () => permissions,
  };
  const guild = {
    id: "333333333333333333",
    name: "Test Guild",
    available: true,
    iconURL: () => "https://cdn.discordapp.com/icons/test.png",
    members: { me: { id: "bot" } },
    channels: {
      cache: new Collection([[channel.id, channel]]),
      fetch: async (id) => (id === channel.id ? channel : null),
    },
    invites: {
      create: async (channelId, options) => {
        sequence += 1;
        const code = `Invite${sequence}`;
        const invite = {
          code,
          uses: 0,
          maxUses: 0,
          expiresTimestamp: null,
          guild: { id: guild.id },
          channel: { id: channelId },
          inviter: actor,
          options,
          delete: async () => {
            invites.delete(code);
          },
        };
        invites.set(code, invite);
        created.push({ channelId, options, invite });
        return invite;
      },
    },
  };
  const client = {
    config: { SMART_INVITES: config, EMBED_COLORS: { BOT_EMBED: "#A855F7" } },
    guilds: { cache: new Collection([[guild.id, guild]]) },
    fetchInvite: async (code) => {
      const invite = invites.get(code);
      if (!invite) {
        const error = new Error("Unknown Invite");
        error.code = 10006;
        throw error;
      }
      return invite;
    },
    logger: { log: () => {}, success: () => {}, error: () => {} },
  };
  const service = new SmartInviteService(client, {
    config,
    now: overrides.now,
    sleep: async () => new Promise((resolve) => setTimeout(resolve, 5)),
  });
  return { config, invites, created, actor, channel, guild, client, service };
}

async function createRecord(fixture, slug, description) {
  return fixture.service.create({
    guildId: fixture.guild.id,
    channelId: fixture.channel.id,
    slug,
    description,
    actor: fixture.actor,
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
