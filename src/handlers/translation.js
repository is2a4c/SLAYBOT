const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { isTranslated, logTranslation } = require("@schemas/TranslateLog");
const data = require("@src/data.json");
const { getLanguagesFromEmoji } = require("country-emoji-languages");
const { translate } = require("@helpers/HttpUtils");
const { timeformat } = require("@helpers/Utils");

const TRANSLATE_COOLDOWN = 120;
const cooldownCache = new Map();

/**
 * @param {import('discord.js').User} user
 */
const getTranslationCooldown = (user, guildId, cooldownSeconds = TRANSLATE_COOLDOWN) => {
  const key = `${guildId || "dm"}|${user.id}`;
  if (cooldownCache.has(key)) {
    const remaining = (Date.now() - cooldownCache.get(key)) * 0.001;
    if (remaining > cooldownSeconds) {
      cooldownCache.delete(key);
      return 0;
    }
    return cooldownSeconds - remaining;
  }
  return 0;
};

/**
 * @param {string} emoji
 * @param {import("discord.js").Message} message
 * @param {import("discord.js").User} user
 */
async function handleFlagReaction(emoji, message, user, settings = {}) {
  // cooldown check
  const cooldownSeconds = Math.min(
    3600,
    Math.max(0, Number(settings?.flag_translation?.cooldown_seconds ?? TRANSLATE_COOLDOWN))
  );
  const remaining = getTranslationCooldown(user, message.guildId, cooldownSeconds);
  if (remaining > 0) {
    return message.channel.safeSend(`${user} You must wait ${timeformat(remaining)} before translating again!`, 5);
  }

  if (await isTranslated(message, emoji)) return;

  const languages = getLanguagesFromEmoji(emoji);

  // filter languages for which google translation is available
  const targetCodes = languages.filter((language) => data.GOOGLE_TRANSLATE[language] !== undefined);
  if (targetCodes.length === 0) return;

  // remove english if there are other language codes
  if (targetCodes.length > 1 && targetCodes.includes("en")) {
    targetCodes.splice(targetCodes.indexOf("en"), 1);
  }

  let src;
  let desc = "";
  let translated = 0;
  for (const tc of targetCodes) {
    const response = await translate(message.content, tc);
    if (!response) continue;
    src = response.inputLang;
    desc += `**${response.outputLang}:**\n${response.output}\n\n`;
    translated += 1;
  }

  if (translated === 0) return;

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder({
      url: message.url,
      label: "Original Message",
      style: ButtonStyle.Link,
    })
  );

  const embed = new EmbedBuilder()
    .setColor(message.client.config.EMBED_COLORS.BOT_EMBED)
    .setAuthor({ name: `Translation from ${src}` })
    .setDescription(desc)
    .setFooter({
      text: `Requested by ${user.username}`,
      iconURL: user.displayAvatarURL(),
    });

  message.channel.safeSend({ embeds: [embed], components: [btnRow] }).then(
    () => cooldownCache.set(`${message.guildId || "dm"}|${user.id}`, Date.now()) // set cooldown
  );

  logTranslation(message, emoji);
}

module.exports = {
  getTranslationCooldown,
  handleFlagReaction,
};
