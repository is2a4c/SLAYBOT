const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const { EVENT_DEFAULT_TEMPLATE, EVENT_GROUPS, EVENT_TYPES } = require("@src/services/eventRouter/catalog");
const { renderEventTemplate, resolveAuditActor, routeEvent } = require("@src/services/eventRouter/EventRouter");
const { buildRoutes, routesForView } = require("../dashboard/services/eventRouterSettings");

const GUILD_ID = "100000000000000000";
const CHANNEL_ID = "100000000000000001";
const OTHER_CHANNEL_ID = "100000000000000002";
const ROLE_ID = "100000000000000003";
const ACTOR_ID = "100000000000000004";
const TARGET_ID = "100000000000000005";

/**
 * A guild good enough for routeEvent: channels/roles it can actually look up,
 * and a channel that records what got sent to it.
 */
function testGuild() {
  const sent = [];
  const channel = {
    id: CHANNEL_ID,
    isTextBased: () => true,
    isThread: () => false,
    safeSend: async (payload) => {
      sent.push(payload);
      return { id: "msg-1" };
    },
  };

  return {
    id: GUILD_ID,
    name: "Test Server",
    channels: { cache: new Map([[CHANNEL_ID, channel]]) },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) },
    _sent: sent,
  };
}

/**
 * routeEvent's own settings/log dependencies, replaced with plain in-memory
 * doubles - the same dependency-injection seam the dashboard services already
 * use, rather than trying to monkeypatch a module that destructured its
 * requires at load time.
 */
function testDependencies(settings) {
  const logged = [];
  return {
    logged,
    deps: {
      getSettings: async () => settings,
      createEventLog: async (entry) => {
        logged.push(entry);
        return entry;
      },
    },
  };
}

/* --------------------------------------------------------------------- catalog */

test("every event has a group and a default template, and nothing extra does", () => {
  for (const type of EVENT_TYPES) {
    assert.ok(EVENT_GROUPS[type], `${type} has no group`);
    assert.ok(EVENT_DEFAULT_TEMPLATE[type], `${type} has no default template`);
  }
  assert.equal(Object.keys(EVENT_GROUPS).length, EVENT_TYPES.length);
  assert.equal(Object.keys(EVENT_DEFAULT_TEMPLATE).length, EVENT_TYPES.length);
});

/* ---------------------------------------------------------------------- render */

test("a template substitutes only the documented variables", () => {
  const text = renderEventTemplate("{actor} did something to {target} in {server}: {detail} ({reason})", {
    actor: { id: ACTOR_ID },
    target: { id: TARGET_ID },
    detail: "general",
    reason: "spam",
    guildName: "Slay HQ",
  });

  assert.equal(text, `<@${ACTOR_ID}> did something to <@${TARGET_ID}> in Slay HQ: general (spam)`);
});

test("a template survives missing pieces without leaving literal placeholders", () => {
  const text = renderEventTemplate("{actor} · {target} · {reason}", {});
  assert.equal(text, "the system ·  · No reason provided");
});

/* ------------------------------------------------------------------- routeEvent */

test("every fire is logged, whether or not a route is configured", async () => {
  const guild = testGuild();
  const { logged, deps } = testDependencies({ event_router: [] });

  await routeEvent(guild, "WARN", { actor: { id: ACTOR_ID }, target: { id: TARGET_ID } }, deps);

  assert.equal(logged.length, 1);
  assert.equal(logged[0].type, "WARN");
  assert.equal(logged[0].actor_id, ACTOR_ID);
  assert.equal(guild._sent.length, 0, "no route was configured, so nothing was posted");
});

test("an enabled route posts to its channel with the default template", async () => {
  const guild = testGuild();
  const { deps } = testDependencies({
    event_router: [{ event: "KICK", enabled: true, channel_id: CHANNEL_ID, template: null, mention_role_id: null }],
  });

  await routeEvent(guild, "KICK", { actor: { id: ACTOR_ID }, target: { id: TARGET_ID }, reason: "rule 3" }, deps);

  assert.equal(guild._sent.length, 1);
  assert.match(guild._sent[0].content, new RegExp(`<@${TARGET_ID}>`));
  assert.match(guild._sent[0].content, /rule 3/);
});

test("a disabled route only logs; a route with no channel only logs", async () => {
  const disabledGuild = testGuild();
  const disabled = testDependencies({
    event_router: [{ event: "BAN", enabled: false, channel_id: CHANNEL_ID, template: null, mention_role_id: null }],
  });
  await routeEvent(disabledGuild, "BAN", { actor: { id: ACTOR_ID } }, disabled.deps);
  assert.equal(disabledGuild._sent.length, 0);

  const noChannelGuild = testGuild();
  const noChannel = testDependencies({
    event_router: [{ event: "BAN", enabled: true, channel_id: null, template: null, mention_role_id: null }],
  });
  await routeEvent(noChannelGuild, "BAN", { actor: { id: ACTOR_ID } }, noChannel.deps);
  assert.equal(noChannelGuild._sent.length, 0);
});

test("a channel the server deleted is skipped, not an error", async () => {
  const guild = testGuild();
  const { logged, deps } = testDependencies({
    event_router: [
      { event: "TIMEOUT", enabled: true, channel_id: "999999999999999999", template: null, mention_role_id: null },
    ],
  });

  await routeEvent(guild, "TIMEOUT", { actor: { id: ACTOR_ID } }, deps);

  assert.equal(logged.length, 1, "the event still happened and is still logged");
  assert.equal(guild._sent.length, 0);
});

test("an unknown event type is a no-op rather than a crash", async () => {
  const guild = testGuild();
  const { logged, deps } = testDependencies({ event_router: [] });
  await routeEvent(guild, "NOT_A_REAL_EVENT", {}, deps);
  assert.equal(logged.length, 0);
  assert.equal(guild._sent.length, 0);
});

test("a server's own template replaces the default text, with its own mention", async () => {
  const guild = testGuild();
  const { deps } = testDependencies({
    event_router: [
      {
        event: "WARN",
        enabled: true,
        channel_id: CHANNEL_ID,
        template: "{target} got warned. Ping {actor}.",
        mention_role_id: ROLE_ID,
      },
    ],
  });

  await routeEvent(guild, "WARN", { actor: { id: ACTOR_ID }, target: { id: TARGET_ID } }, deps);

  assert.match(
    guild._sent[0].content,
    new RegExp(`^<@&${ROLE_ID}> <@${TARGET_ID}> got warned\\. Ping <@${ACTOR_ID}>\\.$`)
  );
  assert.deepEqual(guild._sent[0].allowedMentions.roles, [ROLE_ID]);
});

test("a mention role the server deleted is silently dropped, not sent broken", async () => {
  const guild = testGuild();
  const { deps } = testDependencies({
    event_router: [
      { event: "WARN", enabled: true, channel_id: CHANNEL_ID, template: null, mention_role_id: "999999999999999999" },
    ],
  });

  await routeEvent(guild, "WARN", { actor: { id: ACTOR_ID } }, deps);

  assert.deepEqual(guild._sent[0].allowedMentions.roles, []);
  assert.doesNotMatch(guild._sent[0].content, /<@&/);
});

test("routeEvent never throws when logging itself fails", async () => {
  const guild = testGuild();
  const deps = {
    getSettings: async () => ({ event_router: [] }),
    createEventLog: async () => {
      throw new Error("Mongo is down");
    },
  };

  await assert.doesNotReject(() => routeEvent(guild, "WARN", { actor: { id: ACTOR_ID } }, deps));
});

/* --------------------------------------------------------------- resolveAuditActor */

function auditLogGuild(entries) {
  return {
    fetchAuditLogs: async () => ({
      entries: {
        find: (predicate) => entries.find(predicate),
        first: () => entries[0],
      },
    }),
  };
}

test("resolveAuditActor returns the entry matching the target, not just the newest", async () => {
  const guild = auditLogGuild([
    { target: { id: TARGET_ID }, executor: { id: ACTOR_ID } },
    { target: { id: "other" }, executor: { id: "wrong" } },
  ]);

  const actor = await resolveAuditActor(guild, { type: 1, targetId: TARGET_ID });
  assert.equal(actor.id, ACTOR_ID);
});

test("resolveAuditActor falls back to the newest entry when nothing matches the target", async () => {
  const guild = auditLogGuild([{ target: { id: "other" }, executor: { id: ACTOR_ID } }]);

  const actor = await resolveAuditActor(guild, { type: 1, targetId: "nope-here" });
  assert.equal(actor.id, ACTOR_ID);
});

test("resolveAuditActor never throws - missing View Audit Log just means no attribution", async () => {
  const guild = {
    fetchAuditLogs: async () => {
      throw new Error("Missing Permissions");
    },
  };
  const actor = await resolveAuditActor(guild, { type: 1, targetId: "x" });
  assert.equal(actor, null);
});

/* --------------------------------------------------------------- dashboard input */

function dashboardGuild() {
  return {
    id: GUILD_ID,
    channels: { cache: new Map([[CHANNEL_ID, { id: CHANNEL_ID, isTextBased: () => true, isThread: () => false }]]) },
    roles: { cache: new Map([[ROLE_ID, { id: ROLE_ID }]]) },
  };
}

test("buildRoutes always returns exactly one entry per event type, in catalog order", () => {
  const routes = buildRoutes(dashboardGuild(), {});
  assert.deepEqual(
    routes.map((route) => route.event),
    EVENT_TYPES
  );
  assert.ok(routes.every((route) => route.enabled === false && route.channel_id === null));
});

test("buildRoutes only keeps a channel and role that actually exist on the guild", () => {
  const routes = buildRoutes(dashboardGuild(), {
    enabled_WARN: "on",
    channel_WARN: CHANNEL_ID,
    mention_WARN: ROLE_ID,
    template_WARN: "  custom text  ",
    channel_KICK: OTHER_CHANNEL_ID, // not in this guild's cache
    mention_KICK: "999999999999999999",
  });

  const warn = routes.find((route) => route.event === "WARN");
  assert.equal(warn.enabled, true);
  assert.equal(warn.channel_id, CHANNEL_ID);
  assert.equal(warn.mention_role_id, ROLE_ID);
  assert.equal(warn.template, "custom text");

  const kick = routes.find((route) => route.event === "KICK");
  assert.equal(kick.channel_id, null, "a channel this guild does not have is dropped");
  assert.equal(kick.mention_role_id, null, "a role this guild does not have is dropped");
});

test("routesForView reports every event, with the default template as a placeholder", () => {
  const settings = { event_router: [{ event: "BAN", enabled: true, channel_id: CHANNEL_ID }] };
  const view = routesForView(settings);

  assert.equal(view.length, EVENT_TYPES.length);
  const ban = view.find((route) => route.event === "BAN");
  assert.equal(ban.enabled, true);
  assert.equal(ban.group, "moderation");

  const untouched = view.find((route) => route.event === "ROLE_CREATE");
  assert.equal(untouched.enabled, false);
  assert.equal(untouched.placeholder, EVENT_DEFAULT_TEMPLATE.ROLE_CREATE);
});
