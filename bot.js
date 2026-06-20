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

process.on("unhandledRejection", (err) => client.logger.error(`Unhandled exception`, err));

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

  await client.login(process.env.BOT_TOKEN);
})();
// deploy final test Fri Apr  3 17:41:35 MSK 2026
