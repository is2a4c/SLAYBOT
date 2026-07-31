module.exports = {
  common: {
    enabled: "enabled",
    disabled: "disabled",
    notSet: "not set",
    none: "none",
    cancel: "Cancel",
    unknown: "unknown",
    back: "Back",
    menu: "Menu",
    saved: "Saved.",
    numberRange: "Enter a whole number between {min} and {max}.",
  },

  panels: {
    common: {
      hint: "Use the buttons below — the panel updates as you go.",
      forbidden: "Only someone with **Manage Server** can change these settings.",
    },

    choices: {
      modAction: {
        TIMEOUT: "timeout",
        KICK: "kick",
        BAN: "ban",
      },
      verificationMode: {
        BUTTON: "button",
        CAPTCHA: "captcha",
      },
      aiMode: {
        SHADOW: "watch only",
        ENFORCE: "act on it",
      },
    },

    hub: {
      title: "Control panel",
      description: "Every server setting lives here. Pick the system you want to configure.",
    },

    server: {
      title: "Server",
      description: "The basics: prefix, moderation log, autoroles and odds and ends.",
      fields: {
        prefix: "Prefix",
        modlog: "Log channel",
        autorole: "Autoroles",
        stats: "Levelling",
        invites: "Invite tracking",
        flags: "Flag translation",
        warnlimit: "Warning limit",
        warnaction: "Action at the limit",
        restore: "Restore roles",
        retention: "Keep roles for, days",
      },
    },

    tempvoice: {
      title: "Temporary voice",
      description: "A join-to-create channel hands every member their own voice channel and panel.",
      fields: {
        enabled: "Enabled",
        hub: "Join-to-create channel",
        category: "Category",
        template: "Name template",
        limit: "Default limit",
        locked: "Start locked",
        perMember: "Channels per member",
        claimable: "Claimable",
        panel: "Post the panel",
      },
    },

    ticket: {
      title: "Tickets",
      description: "Where tickets are logged, how many can be open, and who answers them.",
      open: "Open a ticket",
      fields: {
        log: "Log channel",
        limit: "Open ticket limit",
        staff: "Support roles",
        title: "Panel title",
        description: "Panel description",
        panel: "Post the panel",
      },
    },

    verification: {
      title: "Verification",
      description: "Gate newcomers behind a button or a captcha before they see the server.",
      fields: {
        enabled: "Enabled",
        mode: "Mode",
        role: "Verified role",
        removeRole: "Role to remove",
        log: "Log channel",
        captcha: "Captcha length",
        title: "Panel title",
        description: "Panel description",
        button: "Button label",
        panel: "Post the panel",
      },
    },

    welcome: {
      title: "Welcome",
      description: "What the bot says when somebody joins the server.",
      fields: {
        enabled: "Enabled",
        channel: "Channel",
        content: "Message text",
        description: "Embed description",
        color: "Colour",
        footer: "Footer",
        thumbnail: "Member avatar",
        image: "Image",
      },
    },

    farewell: {
      title: "Farewell",
      description: "What the bot says when somebody leaves the server.",
      fields: {
        enabled: "Enabled",
        channel: "Channel",
        content: "Message text",
        description: "Embed description",
        color: "Colour",
        footer: "Footer",
        thumbnail: "Member avatar",
        image: "Image",
      },
    },

    automod: {
      title: "Automod",
      description: "What the bot catches in messages, and what it does about it.",
      fields: {
        strikes: "Strikes before action",
        action: "Action",
        invites: "Other servers' invites",
        links: "Links",
        attachments: "Attachments",
        spam: "Spam",
        imageSpam: "Image spam",
        imageThreshold: "Image threshold, %",
        ghostping: "Ghost pings",
        massMention: "Mass mentions",
        maxLines: "Maximum lines",
        maxMentions: "Maximum mentions",
        maxRoleMentions: "Maximum role mentions",
        debug: "Debug",
      },
    },

    starboard: {
      title: "Starboard",
      description: "Messages with enough reactions get mirrored into their own channel.",
      fields: {
        enabled: "Enabled",
        channel: "Channel",
        emoji: "Emoji",
        threshold: "Reaction threshold",
        selfStar: "Count your own star",
        bots: "Allow bots",
        removeBelow: "Remove when it drops",
      },
    },

    suggestions: {
      title: "Suggestions",
      description: "Where members' ideas land and who approves them.",
      fields: {
        enabled: "Enabled",
        channel: "Suggestion channel",
        approved: "Approved channel",
        rejected: "Rejected channel",
        staff: "Staff roles",
      },
    },

    modmail: {
      title: "Modmail",
      description: "Members' direct messages arrive as private threads.",
      fields: {
        enabled: "Enabled",
        channel: "Thread channel",
        staff: "Support roles",
        anonymous: "Hide staff names",
        mirror: "Forward replies",
      },
    },

    birthdays: {
      title: "Birthdays",
      description: "Birthday wishes and a role for the day.",
      fields: {
        enabled: "Enabled",
        channel: "Channel",
        message: "Message",
        role: "Birthday role",
        hour: "Announcement hour",
        offset: "UTC offset",
        color: "Colour",
      },
    },

    ai: {
      title: "AI",
      description: "Smarter moderation, ticket summaries and answers from your knowledge base.",
      fields: {
        enabled: "Enabled",
        automod: "AI moderation",
        mode: "Moderation mode",
        threshold: "Confidence threshold, %",
        tickets: "Ticket summaries",
        knowledge: "Knowledge base",
        knowledgeText: "Knowledge base text",
        suggestions: "Suggestion analysis",
        forms: "Form analysis",
      },
    },
  },

  language: {
    title: "Bot language",
    description: "Pick the language the bot speaks on this server.",
    current: "Currently: **{value}**",
    auto: "Auto",
    autoValue: "same as the server ({value})",
    forbidden: "Only someone with **Manage Server** can change the language.",
  },

  tempvoice: {
    panel: {
      title: "TempVoice Interface",
      description:
        "Use this **interface** to manage your personal voice channel. " + "`/vc` opens a private copy of this panel.",
      hint: "Use the buttons below to control your channel.",
    },

    actions: {
      name: "Name",
      limit: "Limit",
      access: "Access",
      lobby: "Lobby",
      chat: "Chat",
      trust: "Trust",
      untrust: "Untrust",
      invite: "Invite",
      kick: "Kick",
      region: "Region",
      ban: "Ban",
      unban: "Unban",
      claim: "Claim",
      transfer: "Transfer",
      delete: "Delete",
    },

    hub: {
      created: "Your channel is ready. Control it from the panel in {channel}.",
    },

    errors: {
      notInVoice: "Join your temporary voice channel first.",
      notTemporary: "This voice channel was not created by TempVoice.",
      notOwner: "{owner} owns this channel. Ask for it, or claim it once the owner leaves.",
      ownerPresent: "You can only claim a channel after its owner has left.",
      claimDisabled: "Claiming somebody else's channel is turned off on this server.",
      alreadyOwner: "You already own this channel.",
      targetNotMember: "That member is not on this server.",
      targetIsSelf: "You cannot use this on yourself.",
      targetIsBot: "You cannot use this on a bot.",
      targetIsOwner: "The channel owner cannot be kicked or banned.",
      targetNotInChannel: "{user} is not in your channel right now.",
      missingPermissions: "I am missing the permissions to manage this channel.",
      failed: "That did not work. Try again.",
      disabled: "TempVoice is turned off on this server.",
      limitRange: "The limit must be a number between 0 and 99. Use 0 for no limit.",
      nameLength: "The name must be between 1 and 100 characters.",
      emptyTrusted: "Nobody has been given access to this channel yet.",
      emptyBlocked: "Nobody is banned from this channel.",
      emptyMembers: "There is nobody else in the channel.",
      tooManyChannels: "You already have a temporary channel. Free it up before creating another.",
    },

    prompts: {
      nameTitle: "Channel name",
      nameLabel: "New name",
      limitTitle: "Member limit",
      limitLabel: "How many people may join (0 for no limit)",
      pickTrust: "Who may join the locked channel",
      pickUntrust: "Who loses access",
      pickKick: "Who to disconnect",
      pickBan: "Who to ban from the channel",
      pickUnban: "Who to unban",
      pickTransfer: "Who becomes the new owner",
      pickRegion: "Pick a voice server region",
      regionAuto: "Automatic",
    },

    results: {
      renamed: "Channel renamed to **{name}**.",
      limitSet: "Member limit: **{limit}**.",
      limitCleared: "Member limit removed.",
      locked: "Channel locked — only trusted members can join.",
      unlocked: "Channel unlocked for everyone.",
      hidden: "Channel hidden from the channel list.",
      shown: "Channel is visible again.",
      chatLocked: "Channel chat is closed to people outside it.",
      chatUnlocked: "Channel chat is open.",
      trusted: "{user} can join the channel now.",
      untrusted: "{user} no longer has access to the channel.",
      invited: "Invite sent to {user}.",
      inviteFailed: "Could not reach {user} — their direct messages are closed.",
      kicked: "{user} was disconnected.",
      banned: "{user} is banned from the channel.",
      unbanned: "{user} is unbanned.",
      regionSet: "Channel region: **{region}**.",
      regionAuto: "The channel picks its region automatically.",
      claimed: "The channel is yours now.",
      transferred: "Channel transferred to {user}.",
      deleted: "Channel deleted.",
    },

    invite: {
      title: "Voice channel invite",
      body: "{user} invites you to **{channel}** on **{guild}**.",
      join: "Join",
    },

    setup: {
      done: "TempVoice is on. Join {hub} to get your own channel. The control panel is in {panel}.",
      panelPosted: "Control panel posted in {channel}.",
      disabled: "TempVoice is off. Existing channels are removed once they empty out.",
      missingHub: "Set TempVoice up first: `/tempvoice setup`.",
      statusTitle: "TempVoice · {guild}",
      statusState: "**Status:** {value}",
      statusHub: "**Join-to-create channel:** {value}",
      statusCategory: "**Category:** {value}",
      statusPanel: "**Panel:** {value}",
      statusLimit: "**Default limit:** {value}",
      statusTemplate: "**Name template:** {value}",
      statusActive: "**Active channels:** {value}",
    },
  },
};
