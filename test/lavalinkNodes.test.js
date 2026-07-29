const test = require("node:test");
const assert = require("node:assert/strict");
const { getLavalinkNodes, LOCAL_NODE_ID } = require("../src/helpers/LavalinkNodes");

test("keeps configured nodes unchanged without a local password", () => {
  const configured = [{ id: "public", host: "example.com", port: 443, secure: true }];
  assert.deepEqual(getLavalinkNodes(configured, {}), configured);
});

test("prepends the private local node and preserves public fallbacks", () => {
  const configured = [{ id: "public", host: "example.com", port: 443, secure: true }];
  const nodes = getLavalinkNodes(configured, { LAVALINK_LOCAL_PASSWORD: "secret" });

  assert.equal(nodes[0].id, LOCAL_NODE_ID);
  assert.equal(nodes[0].host, "127.0.0.1");
  assert.equal(nodes[0].port, 2333);
  assert.equal(nodes[0].password, "secret");
  assert.deepEqual(nodes.slice(1), configured);
});

test("does not duplicate an explicitly configured local node", () => {
  const configured = [
    { id: LOCAL_NODE_ID, host: "127.0.0.1", port: 2333, password: "old" },
    { id: "public", host: "example.com", port: 443, secure: true },
  ];
  const nodes = getLavalinkNodes(configured, { LAVALINK_LOCAL_PASSWORD: "new" });

  assert.equal(nodes.filter((node) => node.id === LOCAL_NODE_ID).length, 1);
  assert.equal(nodes[0].password, "new");
  assert.equal(nodes[1].id, "public");
});
