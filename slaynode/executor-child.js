require("module-alias/register");
const { execute } = require("../src/slaynode/executors");
const send = (message) => new Promise((resolve) => process.send(message, resolve));
process.once("message", async ({ type, payload }) => {
  try {
    await send({ ok: true, result: await execute(type, payload) });
  } catch (error) {
    await send({ ok: false, error: String(error.message || error).slice(0, 500) });
  } finally {
    process.disconnect();
  }
});
