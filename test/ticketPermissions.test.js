const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  canCloseTicket,
  getTicketMetadata,
  getTicketStaffRoleIds,
  isTicketStaff,
  parseRoleIds,
  syncCategoryStaffRoleAccess,
  syncStaffRoleAccess,
} = require("../src/helpers/TicketPermissions");
const { requiredClosePermissions } = require("../src/handlers/ticket");

test("closing without transcripts does not require message history", () => {
  assert.deepEqual(requiredClosePermissions({ transcripts: false }), ["ManageChannels"]);
  assert.deepEqual(requiredClosePermissions({ transcripts: true }), ["ManageChannels", "ReadMessageHistory"]);
});

function member(roleIds = [], permissions = []) {
  return {
    roles: {
      cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])),
    },
    permissions: {
      has: (permission) => permissions.includes(permission),
    },
  };
}

const settings = {
  ticket: {
    staff_roles: ["global-support"],
    categories: [
      {
        name: "Billing",
        staff_roles: ["billing-support"],
      },
    ],
  },
};

test("parses ticket owner and category from the channel topic", () => {
  assert.deepEqual(getTicketMetadata({ topic: "tіcket|owner-1|Billing" }), {
    ownerId: "owner-1",
    categoryName: "Billing",
  });
  assert.equal(getTicketMetadata({ topic: "not-a-ticket" }), null);
});

test("combines global and category-specific support roles", () => {
  const roleIds = getTicketStaffRoleIds(settings, { topic: "tіcket|owner-1|Billing" });
  assert.deepEqual(new Set(roleIds), new Set(["global-support", "billing-support"]));
});

test("extracts raw and mentioned Discord role IDs", () => {
  assert.deepEqual(parseRoleIds("<@&123456789012345678>, 234567890123456789, <@&123456789012345678>"), [
    "123456789012345678",
    "234567890123456789",
  ]);
  assert.deepEqual(parseRoleIds("not a role"), []);
});

test("recognizes configured support roles and administrators", () => {
  const channel = { topic: "tіcket|owner-1|Billing" };

  assert.equal(isTicketStaff(member(["global-support"]), settings, channel), true);
  assert.equal(isTicketStaff(member(["billing-support"]), settings, channel), true);
  assert.equal(isTicketStaff(member(["other"]), settings, channel), false);
  assert.equal(isTicketStaff(member([], ["ManageGuild"]), settings, channel), true);
});

test("allows the ticket owner or support staff to close a ticket", () => {
  const channel = { topic: "tіcket|owner-1|Billing" };

  assert.equal(canCloseTicket(member(), "owner-1", settings, channel), true);
  assert.equal(canCloseTicket(member(["global-support"]), "staff-1", settings, channel), true);
  assert.equal(canCloseTicket(member(["other"]), "member-1", settings, channel), false);
});

test("adds a global support overwrite to every open ticket", async () => {
  const edits = [];
  const channels = new Map([
    [
      "ticket-1",
      {
        topic: "tіcket|owner-1|Billing",
        permissionOverwrites: {
          edit: async (role, permissions) => edits.push({ role, permissions }),
          delete: async () => assert.fail("did not expect overwrite deletion"),
        },
      },
    ],
  ]);
  const role = { id: "global-support" };

  assert.deepEqual(await syncStaffRoleAccess(channels, settings, role, true), { updated: 1, failed: 0 });
  assert.deepEqual(edits, [
    {
      role,
      permissions: {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      },
    },
  ]);
});

test("keeps category access when a role is removed from global support", async () => {
  let edited = 0;
  let deleted = 0;
  const channels = new Map([
    [
      "ticket-1",
      {
        topic: "tіcket|owner-1|Billing",
        permissionOverwrites: {
          edit: async () => {
            edited += 1;
          },
          delete: async () => {
            deleted += 1;
          },
        },
      },
    ],
  ]);

  assert.deepEqual(await syncStaffRoleAccess(channels, settings, { id: "billing-support" }, false), {
    updated: 1,
    failed: 0,
  });
  assert.equal(edited, 1);
  assert.equal(deleted, 0);
});

test("updates only open tickets from the selected category", async () => {
  const edits = [];
  const channels = new Map([
    [
      "billing-ticket",
      {
        topic: "tіcket|owner-1|Billing",
        permissionOverwrites: {
          edit: async (role) => edits.push(role.id),
          delete: async () => assert.fail("did not expect overwrite deletion"),
        },
      },
    ],
    [
      "technical-ticket",
      {
        topic: "tіcket|owner-2|Technical",
        permissionOverwrites: {
          edit: async () => assert.fail("wrong category was updated"),
          delete: async () => assert.fail("wrong category was updated"),
        },
      },
    ],
  ]);

  assert.deepEqual(await syncCategoryStaffRoleAccess(channels, settings, "Billing", { id: "new-billing-role" }, true), {
    updated: 1,
    failed: 0,
  });
  assert.deepEqual(edits, ["new-billing-role"]);
});

test("retains a category overwrite when the role is also global staff", async () => {
  let edited = 0;
  let deleted = 0;
  const channels = new Map([
    [
      "billing-ticket",
      {
        topic: "tіcket|owner-1|Billing",
        permissionOverwrites: {
          edit: async () => {
            edited += 1;
          },
          delete: async () => {
            deleted += 1;
          },
        },
      },
    ],
  ]);

  assert.deepEqual(await syncCategoryStaffRoleAccess(channels, settings, "Billing", "global-support", false), {
    updated: 1,
    failed: 0,
  });
  assert.equal(edited, 1);
  assert.equal(deleted, 0);
});
