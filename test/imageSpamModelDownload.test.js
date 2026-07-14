const test = require("node:test");
const assert = require("node:assert/strict");

const { preloadWithRetries } = require("../scripts/download-image-spam-model");

test("retries transient image-spam model download failures", async () => {
  let calls = 0;
  const delays = [];
  const model = await preloadWithRetries(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("fetch failed");
      return "HuggingFaceTB/SmolVLM-Instruct";
    },
    {
      attempts: 3,
      retryDelayMs: 10,
      sleep: async (duration) => delays.push(duration),
    }
  );

  assert.equal(model, "HuggingFaceTB/SmolVLM-Instruct");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("does not retry a non-transient image-spam model failure", async () => {
  let calls = 0;

  await assert.rejects(
    preloadWithRetries(
      async () => {
        calls += 1;
        throw new Error("invalid model configuration");
      },
      { attempts: 3, sleep: async () => {} }
    ),
    /invalid model configuration/
  );

  assert.equal(calls, 1);
});
