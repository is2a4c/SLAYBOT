const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  AutomodEscalationError,
  addEscalationRule,
  createEscalationRule,
  removeEscalationRule,
  selectEscalationRule,
} = require("@src/services/automodEscalation");

test("escalation rules validate, clamp and sort dashboard input", () => {
  const timeout = createEscalationRule({ threshold: "5", action: "timeout", timeout_minutes: "60" }, "a");
  const ban = createEscalationRule({ threshold: "20", action: "BAN" }, "b");
  assert.deepEqual(
    addEscalationRule([ban], timeout).map((entry) => entry.id),
    ["a", "b"]
  );
  assert.equal(timeout.timeout_minutes, 60);
  assert.throws(() => createEscalationRule({ action: "DELETE_SERVER" }), AutomodEscalationError);
  assert.throws(() => addEscalationRule([timeout], { ...ban, threshold: 5 }), AutomodEscalationError);
});

test("only the strictest newly crossed escalation threshold is selected", () => {
  const rules = [
    { id: "a", threshold: 3, action: "TIMEOUT", timeout_minutes: 10 },
    { id: "b", threshold: 7, action: "KICK", timeout_minutes: 1440 },
    { id: "c", threshold: 12, action: "BAN", timeout_minutes: 1440 },
  ];
  assert.equal(selectEscalationRule(rules, 8, 2).id, "b");
  assert.equal(selectEscalationRule(rules, 8, 7), null, "a threshold cannot repeat on the next message");
  assert.equal(selectEscalationRule(rules, 20, 8).id, "c");
});

test("escalation rules can be removed without leaking document internals", () => {
  const result = removeEscalationRule(
    [
      { id: "keep", threshold: 2, action: "TIMEOUT", timeout_minutes: 5, extra: true },
      { id: "drop", threshold: 4, action: "KICK", timeout_minutes: 1440 },
    ],
    "drop"
  );
  assert.deepEqual(result, [{ id: "keep", threshold: 2, action: "TIMEOUT", timeout_minutes: 5 }]);
});
