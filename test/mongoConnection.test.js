const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

/**
 * How long the bot is willing to wait for a database it reaches over the
 * internet, before a click waiting on it is beyond saving.
 */
test("the database is given timeouts a click can live with", () => {
  const { CONNECTION } = require("@src/database/mongoose");

  // Discord gives three seconds; the driver's own default is thirty, which turns
  // a network hiccup into an interaction nobody ever answers.
  assert.ok(CONNECTION.serverSelectionTimeoutMS <= 10000, "picking a server may not outlast the click");
  assert.ok(CONNECTION.socketTimeoutMS > 0, "a socket that stopped answering has to be given up on");
  assert.ok(CONNECTION.maxPoolSize >= 10, "one slow read must not become everybody's slow read");
});
