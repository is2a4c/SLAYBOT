const { getSettings } = require("@schemas/Guild");
const { sendBoostNotification } = require("@src/services/memberNotifications");

module.exports = async (client, oldMember, newMember) => {
  if (oldMember.premiumSinceTimestamp || !newMember.premiumSinceTimestamp) return;
  const settings = await getSettings(newMember.guild);
  await sendBoostNotification(newMember, settings).catch((error) => client.logger.error("boostNotification", error));
};
