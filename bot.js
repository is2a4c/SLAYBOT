require("dotenv").config();
require("module-alias/register");
require("@helpers/ConfigDefaults").applyConfigDefaults();

require("@helpers/extenders/Message");
require("@helpers/extenders/Interaction");
require("@helpers/extenders/Guild");
require("@helpers/extenders/GuildChannel");

const { checkForUpdates } = require("@helpers/BotUtils");
const { initializeMongoose } = require("@src/database/mongoose");
const { BotClient } = require("@src/structures");
const { validateConfiguration } = require("@helpers/Validator");

validateConfiguration();

const client = new BotClient();
client.loadCommands("src/commands");
client.loadContexts("src/contexts");
client.loadEvents("src/events");

process.on("unhandledRejection", (err) => {
  client.telemetry.record("client_errors");
  client.logger.error(`Unhandled exception`, err);
});

(async () => {
  await checkForUpdates();

  if (client.config.DASHBOARD.enabled) {
    client.logger.log("Launching dashboard");
    try {
      const { launch } = require("@root/dashboard/app");

      await launch(client);
    } catch (ex) {
      client.logger.error("Failed to launch dashboard", ex);
    }
  } else {
    await initializeMongoose();
  }

  client.telemetry.start();
  await require("@src/slaynode/control/runtime").start(client);

  await client.login(process.env.BOT_TOKEN);
})();

async function shutdown(signal) {
  client.logger.log(`Received ${signal}, shutting down`);
  await client.telemetry.stop().catch((error) => client.logger.warn(`Final telemetry flush failed: ${error.message}`));
  await require("@src/services/smart-invites/runtime")
    .stop(client)
    .catch(() => {});
  await require("@src/slaynode/control/runtime")
    .stop()
    .catch(() => {});
  client.destroy();
  await require("mongoose")
    .disconnect()
    .catch(() => {});
  process.exit(0);
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
// deploy final test Fri Apr  3 17:41:35 MSK 2026
