const test = require("node:test");
const assert = require("node:assert/strict");

require("module-alias/register");
const memberSchema = require("../src/database/schemas/Member");

let commandMember;
let commandRequest;
memberSchema.getMember = async (guildId, userId) => {
  commandRequest = { guildId, userId };
  return commandMember;
};
delete require.cache[require.resolve("../src/commands/admin/automod/anti")];
const antiCommand = require("../src/commands/admin/automod/anti");

const GUILD_ID = "456789012345678901";
const USER_ID = "123456789012345678";

test.beforeEach(() => {
  commandRequest = undefined;
  commandMember = {
    strikes: 4,
    async save() {},
  };
});

test("resets all automod strikes for a selected user", async () => {
  const member = {
    strikes: 7,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
    },
  };
  let requested;

  const response = await antiCommand.resetMemberStrikes(GUILD_ID, `<@${USER_ID}>`, async (guildId, userId) => {
    requested = { guildId, userId };
    return member;
  });

  assert.deepEqual(requested, { guildId: GUILD_ID, userId: USER_ID });
  assert.equal(member.strikes, 0);
  assert.equal(member.saveCalls, 1);
  assert.match(response, /7 → 0/);
});

test("does not create a write when the user already has no strikes", async () => {
  const member = {
    strikes: 0,
    save: async () => assert.fail("zero strikes must not be saved"),
  };

  const response = await antiCommand.resetMemberStrikes(GUILD_ID, USER_ID, async () => member);

  assert.match(response, /no AutoMod strikes/);
});

test("rejects an invalid target before querying the database", async () => {
  let loaderCalls = 0;

  const response = await antiCommand.resetMemberStrikes(GUILD_ID, "not-a-user", async () => {
    loaderCalls += 1;
  });

  assert.equal(loaderCalls, 0);
  assert.match(response, /Invalid user/);
});

test("registers the strike reset slash command for Manage Server users", () => {
  const slash = antiCommand.slashCommand.options.find((option) => option.name === "strikes-reset");

  assert.deepEqual(antiCommand.userPermissions, ["ManageGuild"]);
  assert.ok(slash);
  assert.equal(slash.options[0].name, "user");
  assert.equal(slash.options[0].required, true);
});

test("prefix strike reset command routes the selected user to the member store", async () => {
  let reply;
  await antiCommand.messageRun(
    {
      guildId: GUILD_ID,
      safeReply: async (response) => {
        reply = response;
      },
    },
    ["strikes-reset", `<@${USER_ID}>`],
    { settings: {} }
  );

  assert.deepEqual(commandRequest, { guildId: GUILD_ID, userId: USER_ID });
  assert.equal(commandMember.strikes, 0);
  assert.match(reply, /4 → 0/);
});

test("slash strike reset command routes the selected user to the member store", async () => {
  let reply;
  await antiCommand.interactionRun(
    {
      guildId: GUILD_ID,
      options: {
        getSubcommand: () => "strikes-reset",
        getUser: () => ({ id: USER_ID }),
      },
      safeFollowUp: async (response) => {
        reply = response;
      },
    },
    { settings: {} }
  );

  assert.deepEqual(commandRequest, { guildId: GUILD_ID, userId: USER_ID });
  assert.equal(commandMember.strikes, 0);
  assert.match(reply, /4 → 0/);
});
