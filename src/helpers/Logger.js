const config = require("@root/config");
const { EmbedBuilder, REST, Routes, WebhookClient } = require("discord.js");
const pino = require("pino");

const botLogChannelId = /^\d{17,20}$/.test(process.env.BOT_LOG_CHANNEL || "") ? process.env.BOT_LOG_CHANNEL : null;
const channelLogger =
  botLogChannelId && process.env.BOT_TOKEN ? new REST({ version: "10" }).setToken(process.env.BOT_TOKEN) : null;
const webhookLogger =
  !channelLogger && process.env.ERROR_LOGS ? new WebhookClient({ url: process.env.ERROR_LOGS }) : null;

const today = new Date();
const pinoLogger = pino.default(
  {
    level: "debug",
  },
  pino.multistream([
    {
      level: "info",
      stream: pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "yyyy-mm-dd HH:mm:ss",
          ignore: "pid,hostname",
          singleLine: false,
          hideObject: true,
          customColors: "info:blue,warn:yellow,error:red",
        },
      }),
    },
    {
      level: "debug",
      stream: pino.destination({
        dest: `${process.cwd()}/logs/combined-${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.log`,
        sync: true,
        mkdir: true,
      }),
    },
  ])
);

function stringify(value, fallback) {
  if (typeof value === "string") return value || fallback;
  if (value == null) return fallback;
  try {
    return JSON.stringify(value, null, 2) || fallback;
  } catch {
    return String(value) || fallback;
  }
}

function truncate(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 14)}\n… truncated`;
}

function sendDiscordLog(content, err) {
  if (!content && !err) return;

  try {
    const description = truncate(stringify(content, "NA"), 1024);
    const details = truncate(stringify(err?.stack || err?.message, "No details"), 1014);
    const embed = new EmbedBuilder()
      .setColor(config.EMBED_COLORS.ERROR)
      .setAuthor({ name: truncate(stringify(err?.name, "Error"), 256) })
      .addFields(
        { name: "Description", value: description },
        { name: "Details", value: `\`\`\`js\n${details}\n\`\`\`` }
      );

    if (channelLogger) {
      channelLogger
        .post(Routes.channelMessages(botLogChannelId), {
          body: { embeds: [embed.toJSON()] },
        })
        .catch(() => {});
    } else if (webhookLogger) {
      webhookLogger.send({ username: "Logs", embeds: [embed] }).catch(() => {});
    }
  } catch (webhookError) {
    pinoLogger.error({ details: webhookError?.stack || String(webhookError) }, "Failed to format webhook log");
  }
}

module.exports = class Logger {
  /**
   * @param {string} content
   */
  static success(content) {
    pinoLogger.info(content);
  }

  /**
   * @param {string} content
   */
  static log(content) {
    pinoLogger.info(content);
  }

  /**
   * @param {string} content
   */
  static warn(content) {
    pinoLogger.warn(content);
  }

  /**
   * @param {string} content
   * @param {object} ex
   */
  static error(content, ex) {
    let message = content;
    let details = "";

    if (ex instanceof Error) {
      message += `: ${ex.message}`;
      details = ex.stack || ex.message;
    } else if (typeof ex === "object" && ex !== null) {
      try {
        details = JSON.stringify(ex, null, 2);
      } catch {
        details = String(ex);
      }
    } else if (ex) {
      details = String(ex);
    }

    pinoLogger.error({ details }, message);

    if (channelLogger || webhookLogger) sendDiscordLog(content, { name: "Error", stack: details, message });
  }

  /**
   * @param {string} content
   */
  static debug(content) {
    pinoLogger.debug(content);
  }
};
