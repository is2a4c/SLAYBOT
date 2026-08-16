const mongoose = require("mongoose");
const { PollSchema, buttonsPath, fieldsPath } = require("./RichMessage");

const ACTION_TYPES = ["SEND_MESSAGE", "SEND_DM", "CHANGE_ROLES", "ADD_REACTION", "SHOW_MODAL"];
const MAX_CUSTOM_COMMANDS = 50;
const MAX_ACTIONS = 10;

// Discord's own modal limits: five text inputs, a 45-character title.
const MAX_MODAL_INPUTS = 5;
const MAX_MODAL_TITLE = 45;
const MODAL_INPUT_STYLES = ["SHORT", "PARAGRAPH"];

// Discord's own option types, by the name the dashboard shows for each. Only the
// ones a custom command can be handed something useful from are here: a
// subcommand or a group is structure rather than a value, and is expressed by
// the `subcommands` list instead.
const OPTION_TYPES = {
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  ROLE: 8,
  MENTIONABLE: 9,
  NUMBER: 10,
};

// Discord only takes a choice list on the three types that carry a plain value.
const CHOICE_TYPES = [OPTION_TYPES.STRING, OPTION_TYPES.INTEGER, OPTION_TYPES.NUMBER];

// Every one of these is Discord's own limit, not ours.
const MAX_OPTIONS = 25;
const MAX_SUBCOMMANDS = 25;
const MAX_CHOICES = 25;

const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

const ChoiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: 100 },
    value: { type: String, required: true, maxlength: 100 },
  },
  { _id: false }
);

const OptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, lowercase: true, trim: true, match: NAME_PATTERN },
    description: { type: String, required: true, maxlength: 100 },
    type: { type: Number, required: true, enum: Object.values(OPTION_TYPES) },
    required: { type: Boolean, default: false },
    choices: {
      type: [ChoiceSchema],
      default: [],
      validate: [(value) => value.length <= MAX_CHOICES, `An option can have at most ${MAX_CHOICES} choices.`],
    },
  },
  { _id: false }
);

const SubcommandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, lowercase: true, trim: true, match: NAME_PATTERN },
    description: { type: String, required: true, maxlength: 100 },
    options: {
      type: [OptionSchema],
      default: [],
      validate: [(value) => value.length <= MAX_OPTIONS, `A subcommand can have at most ${MAX_OPTIONS} parameters.`],
    },
  },
  { _id: false }
);

/**
 * What the bot actually published to Discord for this command, so it can be
 * updated or taken down again without guessing which of a guild's application
 * commands belong to it.
 */
const RegistrationSchema = new mongoose.Schema(
  {
    type: { type: Number, required: true },
    name: { type: String, required: true, maxlength: 32 },
    command_id: { type: String, required: true },
  },
  { _id: false }
);

const ModalInputSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 100 },
    label: { type: String, required: true, maxlength: 45 },
    style: { type: String, enum: MODAL_INPUT_STYLES, default: "SHORT" },
    required: { type: Boolean, default: true },
    min_length: { type: Number, default: null, min: 0, max: 4000 },
    max_length: { type: Number, default: null, min: 1, max: 4000 },
    placeholder: { type: String, default: null, maxlength: 100 },
  },
  { _id: false }
);

const ActionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    type: { type: String, enum: ACTION_TYPES, required: true },
    content: { type: String, default: null, maxlength: 2000 },
    embed_title: { type: String, default: null, maxlength: 256 },
    embed_description: { type: String, default: null, maxlength: 4096 },
    embed_color: { type: String, default: null, maxlength: 7 },
    // SEND_MESSAGE / SEND_DM only: the rest of what a rich message can carry.
    embed_author: { type: String, default: null, maxlength: 256 },
    embed_footer: { type: String, default: null, maxlength: 2048 },
    embed_thumbnail: { type: String, default: null, maxlength: 300 },
    embed_image: { type: String, default: null, maxlength: 300 },
    embed_timestamp: { type: Boolean, default: false },
    fields: fieldsPath(),
    buttons: buttonsPath(),
    // Set only when this action starts a poll instead of sending a message;
    // SEND_DM never carries one, since a poll's vote is scoped to a guild.
    poll: { type: PollSchema, default: null },
    channel_id: { type: String, default: null },
    tts: { type: Boolean, default: false },
    delete_after_seconds: { type: Number, default: 0, min: 0, max: 86400 },
    mention_roles: { type: [String], default: [] },
    emoji: { type: String, default: null, maxlength: 100 },
    add_roles: { type: [String], default: [] },
    remove_roles: { type: [String], default: [] },
    // SHOW_MODAL only: the form itself, and which of the command's other
    // actions runs once it is submitted.
    modal_title: { type: String, default: null, maxlength: MAX_MODAL_TITLE },
    modal_inputs: {
      type: [ModalInputSchema],
      default: [],
      validate: [(value) => value.length <= MAX_MODAL_INPUTS, `A form can have at most ${MAX_MODAL_INPUTS} fields.`],
    },
    confirm_action_id: { type: String, default: null },
  },
  { _id: false }
);

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true, index: true },
    name: { type: String, required: true, lowercase: true, trim: true, minlength: 1, maxlength: 32 },
    description: { type: String, default: null, maxlength: 100 },
    group: { type: String, default: "CUSTOM", maxlength: 32 },
    enabled: { type: Boolean, default: true },
    cooldown_seconds: { type: Number, default: 0, min: 0, max: 86400 },
    delete_invocation: { type: Boolean, default: false },
    allowed_roles: { type: [String], default: [] },
    allowed_channels: { type: [String], default: [] },
    triggers: {
      prefix: { type: Boolean, default: true },
      slash: { type: Boolean, default: false },
      message_context: { type: Boolean, default: false },
      member_context: { type: Boolean, default: false },
    },
    // Context menu entries are shown to people rather than typed, so they may
    // carry spaces and capitals the command name cannot.
    context_label: { type: String, default: null, maxlength: 32 },
    options: {
      type: [OptionSchema],
      default: [],
      validate: [(value) => value.length <= MAX_OPTIONS, `A command can have at most ${MAX_OPTIONS} parameters.`],
    },
    subcommands: {
      type: [SubcommandSchema],
      default: [],
      validate: [
        (value) => value.length <= MAX_SUBCOMMANDS,
        `A command can have at most ${MAX_SUBCOMMANDS} subcommands.`,
      ],
    },
    registrations: { type: [RegistrationSchema], default: [] },
    actions: {
      type: [ActionSchema],
      default: [],
      validate: [(value) => value.length <= MAX_ACTIONS, `A custom command can have at most ${MAX_ACTIONS} actions.`],
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

Schema.index({ guild_id: 1, name: 1 }, { unique: true });

const model = mongoose.models["custom-command"]
  ? mongoose.model("custom-command")
  : mongoose.model("custom-command", Schema);

module.exports = {
  ACTION_TYPES,
  CHOICE_TYPES,
  MAX_ACTIONS,
  MAX_CHOICES,
  MAX_CUSTOM_COMMANDS,
  MAX_MODAL_INPUTS,
  MAX_MODAL_TITLE,
  MAX_OPTIONS,
  MAX_SUBCOMMANDS,
  MODAL_INPUT_STYLES,
  NAME_PATTERN,
  OPTION_TYPES,
  model,
  deleteGuildCustomCommands: (guildId) => model.deleteMany({ guild_id: guildId }),
};
