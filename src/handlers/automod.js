const { EmbedBuilder } = require("discord.js");
const { containsLink, containsDiscordInvite } = require("@helpers/Utils");
const { getMember } = require("@schemas/Member");
const { addModAction, timeoutTarget } = require("@helpers/ModUtils");
const { AUTOMOD } = require("@root/config");
const { addAutoModLogToDb } = require("@schemas/AutomodLogs");
const {
  classifyImage,
  combineImageSpamResults,
  isImageAttachment,
  DEFAULT_THRESHOLD,
} = require("@src/services/imageSpamClassifier");
const { getAiService } = require("@src/services/ai/AiService");
const { selectEscalationRule } = require("@src/services/automodEscalation");

const antispamCache = new Map();
const DEFAULT_SPAM_WINDOW_SECONDS = 3;

function splitFilterEntries(value, max = 100) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normalizeFilterText(value, caseSensitive = false) {
  const normalized = String(value || "").normalize("NFKC");
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

function termMatches(content, term, mode) {
  if (mode === "EXACT") return content.trim() === term.trim();
  if (mode === "WORD") {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "u").test(content);
  }
  return content.includes(term);
}

function matchesContentFilter(content, automod) {
  if (!automod?.filter_enabled || !content) return null;
  const caseSensitive = Boolean(automod.filter_case_sensitive);
  const normalized = normalizeFilterText(content, caseSensitive);
  const mode = ["CONTAINS", "WORD", "EXACT"].includes(automod.filter_match_mode)
    ? automod.filter_match_mode
    : "CONTAINS";
  const normalizeEntries = (value) =>
    splitFilterEntries(value).map((entry) => normalizeFilterText(entry, caseSensitive));

  if (normalizeEntries(automod.filter_exceptions).some((entry) => termMatches(normalized, entry, mode))) return null;
  return normalizeEntries(automod.filter_terms).find((entry) => termMatches(normalized, entry, mode)) || null;
}

function extractLinkDomains(content) {
  const matches = String(content || "").match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [];
  return matches
    .map((raw) => {
      try {
        return new URL(raw.startsWith("www.") ? `https://${raw}` : raw).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function domainMatches(hostname, configured) {
  const domain = configured
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function shouldBlockLinks(content, automod) {
  if (!automod?.anti_links || !containsLink(content)) return false;
  const mode = ["ALL", "ALLOWLIST", "BLOCKLIST"].includes(automod.link_mode) ? automod.link_mode : "ALL";
  if (mode === "ALL") return true;
  const domains = splitFilterEntries(automod.link_domains).map((entry) => entry.toLowerCase());
  const hosts = extractLinkDomains(content);
  if (mode === "ALLOWLIST")
    return hosts.length === 0 || hosts.some((host) => !domains.some((item) => domainMatches(host, item)));
  return hosts.some((host) => domains.some((item) => domainMatches(host, item)));
}

function shouldBlockInvites(content, automod) {
  if (!automod?.anti_invites || !containsDiscordInvite(content)) return false;
  const allowed = new Set(splitFilterEntries(automod.allowed_invite_codes).map((entry) => entry.toLowerCase()));
  if (!allowed.size) return true;
  const codes = [...String(content || "").matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([^\s/]+)/gi)].map(
    (match) => match[1].replace(/[^\w-].*$/, "").toLowerCase()
  );
  return codes.length === 0 || codes.some((code) => !allowed.has(code));
}

function inspectCaps(content) {
  const letters = String(content || "").match(/\p{L}/gu) || [];
  const uppercase = letters.filter(
    (letter) => letter === letter.toLocaleUpperCase() && letter !== letter.toLocaleLowerCase()
  );
  return {
    letters: letters.length,
    percent: letters.length ? Math.round((uppercase.length / letters.length) * 100) : 0,
  };
}

function countEmoji(content) {
  const unicode = String(content || "").match(/\p{Extended_Pictographic}/gu) || [];
  const custom = String(content || "").match(/<a?:\w{2,32}:\d{17,20}>/g) || [];
  return unicode.length + custom.length;
}

function inspectZalgo(content) {
  const decomposed = String(content || "").normalize("NFD");
  const marks = decomposed.match(/\p{M}/gu)?.length || 0;
  const bases = decomposed.match(/[\p{L}\p{N}]/gu)?.length || 0;
  return { marks, percent: bases ? Math.round((marks / bases) * 100) : 0 };
}

function matchesScam(content) {
  const text = normalizeFilterText(content);
  const suspiciousHost =
    /(?:https?:\/\/)?(?:[^\s/]*xn--[^\s/]*|discord(?:-?gift|-?nitro|app)?\.(?:click|gift|win|xyz|top))\b/u.test(text);
  const reward = /\b(?:free|gift|nitro|airdrop|prize|reward|steam|скин|нитро|подарок|приз|раздач)\w*/u.test(text);
  const pressure =
    /\b(?:claim|verify|login|wallet|password|scan|urgent|получ|подтверд|войти|кошел|парол|срочно)\w*/u.test(text);
  const link = extractLinkDomains(text).length > 0;
  return suspiciousHost || (link && reward && pressure);
}

function isAntiSpamWhitelisted(message, automod) {
  const userIds = automod.spam_whitelist_users || [];
  const roleIds = automod.spam_whitelist_roles || [];

  if (userIds.includes(message.author.id)) {
    return true;
  }

  if (message.member?.roles?.cache?.some((role) => roleIds.includes(role.id))) {
    return true;
  }

  return false;
}

function isRepeatedMessage(message, automod = {}, timestamp = Date.now()) {
  const key = message.author.id + "|" + message.guildId;
  const antispamInfo = antispamCache.get(key);
  const windowMs =
    Math.min(300, Math.max(1, Number(automod.spam_window_seconds) || DEFAULT_SPAM_WINDOW_SECONDS)) * 1000;
  const maxRepeats = Math.min(20, Math.max(2, Number(automod.spam_max_repeats) || 2));
  const sameWindow = antispamInfo?.content === message.content && timestamp - antispamInfo.timestamp < windowMs;
  const repeats = sameWindow ? antispamInfo.repeats + 1 : 1;

  antispamCache.set(key, { content: message.content, timestamp, repeats, windowMs });
  return repeats >= maxRepeats;
}

// Cleanup the cache
setInterval(
  () => {
    antispamCache.forEach((value, key) => {
      if (Date.now() - value.timestamp > (value.windowMs || DEFAULT_SPAM_WINDOW_SECONDS * 1000)) {
        antispamCache.delete(key);
      }
    });
  },
  10 * 60 * 1000
).unref();

/**
 * Check if the message needs to be moderated and has required permissions
 * @param {import('discord.js').Message} message
 */
const shouldModerate = (message) => {
  const { member, guild, channel } = message;

  // Ignore if bot cannot delete channel messages
  if (!channel.permissionsFor(guild.members.me)?.has("ManageMessages")) return false;

  // Ignore Possible Guild Moderators
  if (member.permissions.has(["KickMembers", "BanMembers", "ManageGuild"])) return false;

  // Ignore Possible Channel Moderators
  if (channel.permissionsFor(message.member).has("ManageMessages")) return false;
  return true;
};

async function inspectImageSpam(message, automod, classifier = classifyImage) {
  const fields = [];
  const images = [...message.attachments.values()].filter(isImageAttachment);
  if (!images.length) return { shouldDelete: false, strikes: 0, fields };

  const threshold = Math.min(100, Math.max(50, automod.image_spam_threshold || DEFAULT_THRESHOLD));
  const results = [];
  const recognizedContext = [];
  const startedAt = Date.now();

  // Analyze every attachment in order and carry recognized text forward. This
  // lets later images be reviewed with the context found in earlier ones while
  // still isolating download/OCR/vision failures to a single attachment.
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    try {
      const accumulatedCaption = [
        message.content,
        recognizedContext.length ? `Text recognized in previous images:\n${recognizedContext.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const result = await classifier({
        url: image.url,
        caption: accumulatedCaption,
        threshold,
        guildId: message.guildId,
      });
      results.push({ ...result, imageIndex: index });
      if (result.ocrText?.trim() && result.confidence >= 25) {
        recognizedContext.push(`Image ${index + 1}: ${result.ocrText.trim()}`);
      }
    } catch (error) {
      message.client.logger.warn(
        `Image-spam analysis skipped attachment ${index + 1}/${images.length} on message ${message.id}: ${error.message}`
      );
    }
  }

  const combined = combineImageSpamResults(results, { caption: message.content, threshold });
  // Logged whatever the verdict: a check that decides "not spam" used to leave
  // no trace at all, which from outside is indistinguishable from a hung bot.
  message.client?.logger?.log?.(
    `image check: ${images.length} image(s) in ${Date.now() - startedAt}ms — ` +
      `score ${combined.score}/${threshold}, ${combined.risky ? "REMOVED" : "allowed"}, ` +
      `model ${combined.model}${combined.ocrText ? `, text "${combined.ocrText.slice(0, 60).replace(/\s+/g, " ")}"` : ", no text read"}`
  );

  if (!combined.risky) return { shouldDelete: false, strikes: 0, fields };

  const label =
    images.length > 1 && combined.strongestIndex >= 0
      ? ` (strongest image ${combined.strongestIndex + 1}/${images.length})`
      : "";
  fields.push({
    name: `Image-Spam Risk: ${combined.score}/100${label}`,
    value:
      [`Model: ${combined.model}`, ...combined.reasons].join("\n").slice(0, 1024) ||
      "multiple suspicious image signals",
    inline: false,
  });
  if (combined.ocrText) {
    fields.push({
      name: `Combined OCR (${combined.confidence}% max confidence)`,
      value: combined.ocrText.slice(0, 1024),
      inline: false,
    });
  }
  return { shouldDelete: true, strikes: 1, fields };
}

async function inspectTextRisk(message, aiSettings, classifier) {
  const fields = [];
  const content = String(message.content || "").trim();
  if (!aiSettings?.enabled || !aiSettings.automod_enabled || !content) {
    return { shouldDelete: false, strikes: 0, shadowTriggered: false, fields };
  }

  const threshold = Math.min(100, Math.max(50, Number(aiSettings.automod_threshold) || 85));
  const mode = aiSettings.automod_mode === "ENFORCE" ? "ENFORCE" : "SHADOW";
  const classify =
    classifier ||
    ((input) =>
      getAiService().moderateText({
        content: input.content,
        guildId: input.guildId,
      }));

  const result = await classify({ content, guildId: message.guildId });
  if (!result?.risky || Number(result.score) < threshold) {
    return { shouldDelete: false, strikes: 0, shadowTriggered: false, fields };
  }

  const score = Math.min(100, Math.max(0, Math.round(Number(result.score) || 0)));
  const category = String(result.category || "OTHER").slice(0, 50);
  const reason = String(result.reason || "No reason provided").slice(0, 700);
  fields.push({
    name: `AI Text Risk: ${score}/100 (${mode})`,
    value: `Category: ${category}\n${reason}`.slice(0, 1024),
    inline: false,
  });

  return {
    shouldDelete: mode === "ENFORCE",
    strikes: mode === "ENFORCE" ? 1 : 0,
    shadowTriggered: mode === "SHADOW",
    fields,
  };
}

/**
 * Perform moderation on the message
 * @param {import('discord.js').Message} message
 * @param {object} settings
 */
async function performAutomod(message, settings, imageClassifier = classifyImage, textClassifier) {
  const { automod } = settings;
  const ordinaryMember = shouldModerate(message);

  if ((automod.wh_channels || []).includes(message.channelId)) {
    return { triggered: false, deleted: false, strikes: 0 };
  }
  if (!automod.debug && !ordinaryMember) {
    return { triggered: false, deleted: false, strikes: 0 };
  }

  const { channel, member, guild, content, author, mentions } = message;
  const logChannel = settings.modlog_channel ? channel.guild.channels.cache.get(settings.modlog_channel) : null;

  let shouldDelete = false;
  let strikesTotal = 0;
  let shadowTriggered = false;
  let filterTriggered = false;

  const fields = [];

  if (automod.anti_caps) {
    const caps = inspectCaps(content);
    const minimum = Math.min(1000, Math.max(1, Number(automod.caps_min_letters) || 8));
    const threshold = Math.min(100, Math.max(10, Number(automod.caps_percent) || 75));
    if (caps.letters >= minimum && caps.percent >= threshold) {
      fields.push({ name: "Excessive CAPS", value: `${caps.percent}%/${threshold}%`, inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  if (automod.anti_emoji) {
    const emoji = countEmoji(content);
    const maximum = Math.min(100, Math.max(1, Number(automod.max_emoji) || 12));
    if (emoji > maximum) {
      fields.push({ name: "Emoji Flood", value: `${emoji}/${maximum}`, inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  if (automod.anti_zalgo) {
    const zalgo = inspectZalgo(content);
    const threshold = Math.min(100, Math.max(1, Number(automod.zalgo_percent) || 30));
    if (zalgo.marks >= 3 && zalgo.percent >= threshold) {
      fields.push({ name: "Zalgo Text", value: `${zalgo.percent}%/${threshold}%`, inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  if (automod.anti_scam && matchesScam(content)) {
    fields.push({ name: "Scam Pattern", value: "Suspicious link and social-engineering signals", inline: true });
    shouldDelete = true;
    strikesTotal += 1;
  }

  const filteredTerm = matchesContentFilter(content, automod);
  if (filteredTerm) {
    filterTriggered = true;
    fields.push({
      name: "Content Filter",
      value: `Matched configured ${automod.filter_match_mode || "CONTAINS"} filter`,
      inline: true,
    });
    shouldDelete ||= automod.filter_delete !== false;
    strikesTotal += Math.min(10, Math.max(0, Number(automod.filter_strikes) || 0));
  }

  // Debug mode intentionally exercises automod against moderators/owners too,
  // so a real message follows the same image-classification path as members.
  // A classifier outage must never block a message.
  if (automod.anti_image_spam && (ordinaryMember || automod.debug)) {
    const result = await inspectImageSpam(message, automod, imageClassifier);
    fields.push(...result.fields);
    shouldDelete ||= result.shouldDelete;
    strikesTotal += result.strikes;
  }

  if (settings.ai?.enabled && settings.ai.automod_enabled && (ordinaryMember || automod.debug) && content.trim()) {
    try {
      const result = await inspectTextRisk(message, settings.ai, textClassifier);
      fields.push(...result.fields);
      shouldDelete ||= result.shouldDelete;
      strikesTotal += result.strikes;
      shadowTriggered ||= result.shadowTriggered;
    } catch (error) {
      message.client.logger.warn(`AI text moderation skipped message ${message.id}: ${error.message}`);
    }
  }

  // Max mentions
  if (mentions.members.size > automod.max_mentions) {
    fields.push({ name: "Mentions", value: `${mentions.members.size}/${automod.max_mentions}`, inline: true });
    // strikesTotal += mentions.members.size - automod.max_mentions;
    strikesTotal += 1;
  }

  // Maxrole mentions
  if (mentions.roles.size > automod.max_role_mentions) {
    fields.push({ name: "RoleMentions", value: `${mentions.roles.size}/${automod.max_role_mentions}`, inline: true });
    // strikesTotal += mentions.roles.size - automod.max_role_mentions;
    strikesTotal += 1;
  }

  if (automod.anti_massmention > 0) {
    // check everyone mention
    if (mentions.everyone) {
      fields.push({ name: "Everyone Mention", value: "✓", inline: true });
      strikesTotal += 1;
    }

    // check user/role mentions
    if (mentions.users.size + mentions.roles.size > automod.anti_massmention) {
      fields.push({
        name: "User/Role Mentions",
        value: `${mentions.users.size + mentions.roles.size}/${automod.anti_massmention}`,
        inline: true,
      });
      // strikesTotal += mentions.users.size + mentions.roles.size - automod.anti_massmention;
      strikesTotal += 1;
    }
  }

  // Max Lines
  if (automod.max_lines > 0) {
    const count = content.split("\n").length;
    if (count > automod.max_lines) {
      fields.push({ name: "New Lines", value: `${count}/${automod.max_lines}`, inline: true });
      shouldDelete = true;
      // strikesTotal += Math.ceil((count - automod.max_lines) / automod.max_lines);
      strikesTotal += 1;
    }
  }

  // Anti Attachments
  if (automod.anti_attachments) {
    if (message.attachments.size > 0) {
      fields.push({ name: "Attachments Found", value: "✓", inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  // Anti links
  if (automod.anti_links) {
    if (shouldBlockLinks(content, automod)) {
      fields.push({ name: "Links Found", value: "✓", inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  // Anti Spam
  const antiSpamWhitelisted = isAntiSpamWhitelisted(message, automod);
  if (automod.anti_spam && !antiSpamWhitelisted) {
    if (isRepeatedMessage(message, automod)) {
      fields.push({ name: "AntiSpam Detection", value: "✓", inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  // Anti Invites
  if (automod.anti_invites) {
    if (shouldBlockInvites(content, automod)) {
      fields.push({ name: "Discord Invites", value: "✓", inline: true });
      shouldDelete = true;
      strikesTotal += 1;
    }
  }

  // delete message if deletable
  let deleted = false;
  if (shouldDelete && message.deletable) {
    try {
      await message.delete();
      deleted = true;
      channel.safeSend("> Auto-Moderation! Message deleted", 5);
    } catch {
      // ignore message deletion failure
    }
  }

  if (strikesTotal > 0 || shadowTriggered || filterTriggered) {
    // log to db
    const reason = fields.map((field) => field.name + ": " + field.value).join("\n");
    addAutoModLogToDb(member, content, reason, strikesTotal).catch(() => {});

    // send automod log
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setAuthor({ name: "Auto Moderation" })
        .setThumbnail(author.displayAvatarURL())
        .setColor(AUTOMOD.LOG_EMBED)
        .addFields(fields)
        .setDescription(`**Channel:** ${channel.toString()}\n**Content:**\n${content}`)
        .setFooter({
          text: `By ${author.username} | ${author.id}`,
          iconURL: author.avatarURL(),
        });

      logChannel.safeSend({ embeds: [logEmbed] });
    }
  }

  if (strikesTotal > 0) {
    // add strikes to member
    const memberDb = await getMember(guild.id, author.id);
    const previousStrikes = memberDb.strikes;
    memberDb.strikes += strikesTotal;
    const escalation = selectEscalationRule(automod.escalation_rules, memberDb.strikes, previousStrikes);
    const nextThreshold = [...(automod.escalation_rules || [])]
      .filter((entry) => entry.threshold > memberDb.strikes)
      .sort((left, right) => left.threshold - right.threshold)[0]?.threshold;
    const displayedLimit = escalation?.threshold || nextThreshold || automod.strikes;

    // DM strike details
    const strikeEmbed = new EmbedBuilder()
      .setColor(AUTOMOD.DM_EMBED)
      .setThumbnail(guild.iconURL())
      .setAuthor({ name: "Auto Moderation" })
      .addFields(fields)
      .setDescription(
        `You have received ${strikesTotal} strikes!\n\n` +
          `**Guild:** ${guild.name}\n` +
          `**Total Strikes:** ${memberDb.strikes} out of ${displayedLimit}`
      );

    author.send({ embeds: [strikeEmbed] }).catch((ex) => {
      message.client.logger.debug("Failed to send automod DM to user", ex);
    });

    // check if max strikes are received
    if (escalation || (!automod.escalation_rules?.length && memberDb.strikes >= automod.strikes)) {
      const action = escalation?.action || automod.action;
      const timeoutMs = (Number(escalation?.timeout_minutes) || 1440) * 60 * 1000;
      if (!automod.escalation_rules?.length || automod.reset_strikes_on_action) memberDb.strikes = 0;

      const actionPromise =
        action === "TIMEOUT" && escalation
          ? timeoutTarget(guild.members.me, member, timeoutMs, `Automod: escalation at ${escalation.threshold} strikes`)
          : addModAction(guild.members.me, member, "Automod: strike threshold received", action);
      await actionPromise.catch((ex) => {
        guild.client.logger.error("Automod action failed", ex);
      });
    }

    await memberDb.save();
  }

  return {
    triggered: strikesTotal > 0 || filterTriggered,
    deleted,
    strikes: strikesTotal,
    shadowTriggered,
  };
}

module.exports = {
  performAutomod,
  inspectImageSpam,
  inspectTextRisk,
  matchesContentFilter,
  shouldBlockInvites,
  shouldBlockLinks,
  inspectCaps,
  countEmoji,
  inspectZalgo,
  matchesScam,
  splitFilterEntries,
  isAntiSpamWhitelisted,
  isRepeatedMessage,
  antispamCache,
};
