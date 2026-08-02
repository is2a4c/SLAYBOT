const { Collection } = require("discord.js");

/**
 * Running a prefix-only command from a panel click.
 *
 * Some commands never got a slash version — reaction roles, the purge family,
 * the invite tools. They read a `Message` and the words after the prefix, so the
 * panel hands them exactly that: one line of arguments, typed into a box, and a
 * stand-in message that answers through the interaction it came from.
 *
 * Only what those commands actually touch is provided. Anything else would be a
 * guess, and a guess that silently returns undefined is worse than a stack trace.
 */

const MENTION = {
  user: /^<@!?(\d{17,20})>$/,
  role: /^<@&(\d{17,20})>$/,
  channel: /^<#(\d{17,20})>$/,
};

/**
 * What a command would have found in `message.mentions`, read back out of the
 * arguments somebody typed.
 *
 * @param {string[]} args
 * @param {import('discord.js').Guild} guild
 */
function collectMentions(args, guild) {
  const users = new Collection();
  const members = new Collection();
  const roles = new Collection();
  const channels = new Collection();

  for (const arg of args) {
    const user = MENTION.user.exec(arg);
    if (user) {
      const member = guild?.members?.cache?.get(user[1]);
      if (member) {
        members.set(member.id, member);
        users.set(member.id, member.user);
      }
      continue;
    }

    const role = MENTION.role.exec(arg);
    if (role) {
      const found = guild?.roles?.cache?.get(role[1]);
      if (found) roles.set(found.id, found);
      continue;
    }

    const channel = MENTION.channel.exec(arg);
    if (channel) {
      const found = guild?.channels?.cache?.get(channel[1]);
      if (found) channels.set(found.id, found);
    }
  }

  return { users, members, roles, channels, everyone: false };
}

/**
 * A stand-in for the message a prefix command expects to have been sent.
 *
 * @param {import('discord.js').Interaction} interaction the click that ran it
 * @param {Object} input
 * @param {object} input.command
 * @param {string[]} input.args
 * @param {string} input.prefix
 * @returns {object}
 */
function asMessage(interaction, { command, args, prefix }) {
  const content = `${prefix}${command.name}${args.length ? ` ${args.join(" ")}` : ""}`;
  const answer = (payload) => interaction.safeFollowUp(payload);

  return {
    id: interaction.id,
    content,
    client: interaction.client,
    guild: interaction.guild,
    guildId: interaction.guildId,
    channel: interaction.channel,
    channelId: interaction.channelId,
    member: interaction.member,
    author: interaction.user,
    mentions: collectMentions(args, interaction.guild),
    createdTimestamp: Date.now(),
    // Commands answer with one of these three; all of them are the same answer.
    safeReply: answer,
    reply: answer,
    followUp: answer,
    // A command that tidies up after itself has nothing to delete here.
    delete: async () => null,
    deletable: false,
  };
}

module.exports = { asMessage, collectMentions };
