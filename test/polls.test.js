const test = require("node:test");
const assert = require("node:assert/strict");
require("module-alias/register");

const {
  PollError,
  applyVote,
  assertQuestion,
  buildPollEmbed,
  buildResultSummary,
  parseOptions,
  tally,
} = require("../src/helpers/Polls");

const poll = (overrides = {}) => ({
  message_id: "111111111111111111",
  question: "Lunch?",
  options: [{ label: "Pizza" }, { label: "Sushi" }, { label: "Salad" }],
  votes: new Map(),
  multi: false,
  anonymous: true,
  allow_change: true,
  ends_at: null,
  closed: false,
  ...overrides,
});

test("options are split on the pipe and validated", () => {
  assert.deepEqual(parseOptions("Pizza | Sushi"), [
    { label: "Pizza", emoji: "1️⃣" },
    { label: "Sushi", emoji: "2️⃣" },
  ]);

  assert.throws(() => parseOptions("only one"), PollError);
  assert.throws(() => parseOptions("a|A"), /listed twice/);
  assert.throws(() => parseOptions(Array.from({ length: 11 }, (_, i) => `o${i}`).join("|")), /at most 10 options/);
});

test("the question is trimmed and length checked", () => {
  assert.equal(assertQuestion("  Lunch?  "), "Lunch?");
  assert.throws(() => assertQuestion("   "), /Ask a question/);
  assert.throws(() => assertQuestion("x".repeat(301)), /under 300 characters/);
});

test("single choice replaces the previous vote", () => {
  const current = poll({ votes: new Map([["u1", [0]]]) });
  assert.deepEqual(applyVote({ poll: current, userId: "u1", selected: [2] }), { picks: [2], error: null });
  assert.match(applyVote({ poll: current, userId: "u1", selected: [0, 1] }).error, /single choice/);
});

test("multiple choice toggles options", () => {
  const current = poll({ multi: true, votes: new Map([["u1", [0, 1]]]) });

  assert.deepEqual(applyVote({ poll: current, userId: "u1", selected: [1] }), { picks: [0], error: null });
  assert.deepEqual(applyVote({ poll: current, userId: "u1", selected: [2] }), { picks: [0, 1, 2], error: null });
});

test("final polls refuse a second vote and closed polls refuse every vote", () => {
  const final = poll({ allow_change: false, votes: new Map([["u1", [1]]]) });
  assert.match(applyVote({ poll: final, userId: "u1", selected: [2] }).error, /does not allow changes/);
  assert.deepEqual(applyVote({ poll: final, userId: "u2", selected: [2] }), { picks: [2], error: null });

  assert.match(applyVote({ poll: poll({ closed: true }), userId: "u1", selected: [0] }).error, /closed/);
});

test("out-of-range options are ignored", () => {
  assert.match(applyVote({ poll: poll(), userId: "u1", selected: [9] }).error, /at least one option/);
});

test("the tally counts every pick and every voter once", () => {
  const current = poll({
    multi: true,
    votes: new Map([
      ["u1", [0, 1]],
      ["u2", [0]],
      ["u3", []],
    ]),
  });

  const result = tally(current);
  assert.deepEqual(result.counts, [2, 1, 0]);
  assert.equal(result.total, 3);
  assert.equal(result.voters, 2);
  assert.deepEqual(result.voterIds[0], ["u1", "u2"]);
});

test("the embed shows bars and hides voters unless the poll is public", () => {
  const current = poll({ votes: new Map([["u1", [0]]]) });

  const anonymous = buildPollEmbed(current).data;
  assert.match(anonymous.description, /Pizza\*\* — 1/);
  assert.ok(!anonymous.description.includes("<@u1>"));
  assert.match(anonymous.footer.text, /1 voter · single choice · anonymous/);

  const open = buildPollEmbed({ ...current, anonymous: false }, { showVoters: true }).data;
  assert.match(open.description, /<@u1>/);
});

test("the result names a winner or reports a tie", () => {
  assert.match(buildResultSummary(poll({ votes: new Map([["u1", [1]]]) })), /\*\*Sushi\*\* wins with 1 of 1 vote\./);
  assert.match(
    buildResultSummary(
      poll({
        votes: new Map([
          ["u1", [0]],
          ["u2", [1]],
        ]),
      })
    ),
    /Tie between \*\*Pizza\*\*, \*\*Sushi\*\*/
  );
  assert.equal(buildResultSummary(poll()), "Nobody voted.");
});
