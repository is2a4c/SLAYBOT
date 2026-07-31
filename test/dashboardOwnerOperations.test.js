const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const operationsRouter = require("../dashboard/routes/owner/operations");
const { requireOwner } = require("../dashboard/auth/middleware");

test("owner operations expose the same safe Smart Invite actions as the owner command", () => {
  assert.deepEqual([...operationsRouter.SMART_INVITE_ACTIONS].sort(), [
    "block-guild",
    "disable",
    "reserve",
    "unblock-guild",
    "unlock",
  ]);
});

test("owner operations router is protected by the strict OWNER_IDS middleware", () => {
  assert.equal(operationsRouter.stack[0].handle, requireOwner);
});

test("requireOwner permits configured owners and rejects ordinary authenticated users", () => {
  let ownerNext = false;
  requireOwner(
    {
      session: { user: { id: "100000000000000001" } },
      client: { config: { OWNER_IDS: ["100000000000000001"] } },
    },
    {},
    () => {
      ownerNext = true;
    }
  );
  assert.equal(ownerNext, true);

  let status;
  let rendered;
  requireOwner(
    {
      session: { user: { id: "200000000000000002" } },
      client: { config: { OWNER_IDS: ["100000000000000001"] } },
    },
    {
      status(code) {
        status = code;
        return this;
      },
      render(view, locals) {
        rendered = { view, locals };
      },
    },
    () => assert.fail("ordinary user must not enter owner operations")
  );
  assert.equal(status, 403);
  assert.equal(rendered.view, "error");
});
