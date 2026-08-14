const mongoose = require("mongoose");

/**
 * The pieces a rich message can be built from, shared by every schema that
 * stores one: custom command actions, and the server's own welcome/farewell
 * greetings. One definition means one set of Discord's own limits, checked in
 * one place, rather than a slightly different bound drifting into each copy.
 */

const MAX_FIELDS = 25;
const MAX_FIELD_NAME = 256;
const MAX_FIELD_VALUE = 1024;

const MAX_BUTTONS = 5;
const MAX_BUTTON_LABEL = 80;
const MAX_BUTTON_URL = 512;

const MAX_POLL_QUESTION = 300;
const MAX_POLL_OPTIONS = 10;
const MAX_POLL_OPTION_LABEL = 80;
const MAX_POLL_DURATION_MINUTES = 30 * 24 * 60;

const FieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, maxlength: MAX_FIELD_NAME },
    value: { type: String, required: true, maxlength: MAX_FIELD_VALUE },
    inline: { type: Boolean, default: false },
  },
  { _id: false }
);

// A button here can only ever be a link: opening a URL needs nothing from the
// bot once it is sent, where anything else would need an interaction handler
// and a real action behind it that does not exist for a static message.
const ButtonSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, maxlength: MAX_BUTTON_LABEL },
    url: { type: String, required: true, maxlength: MAX_BUTTON_URL },
    emoji: { type: String, default: null, maxlength: 100 },
  },
  { _id: false }
);

const PollSchema = new mongoose.Schema(
  {
    question: { type: String, default: null, maxlength: MAX_POLL_QUESTION },
    options: {
      type: [String],
      default: [],
      validate: [(value) => value.length <= MAX_POLL_OPTIONS, `A poll can have at most ${MAX_POLL_OPTIONS} options.`],
    },
    multi: { type: Boolean, default: false },
    duration_minutes: { type: Number, default: null, min: 1, max: MAX_POLL_DURATION_MINUTES },
  },
  { _id: false }
);

const fieldsPath = (max = MAX_FIELDS) => ({
  type: [FieldSchema],
  default: [],
  validate: [(value) => value.length <= max, `At most ${max} fields.`],
});

const buttonsPath = (max = MAX_BUTTONS) => ({
  type: [ButtonSchema],
  default: [],
  validate: [(value) => value.length <= max, `At most ${max} buttons.`],
});

module.exports = {
  ButtonSchema,
  FieldSchema,
  MAX_BUTTONS,
  MAX_BUTTON_LABEL,
  MAX_BUTTON_URL,
  MAX_FIELDS,
  MAX_FIELD_NAME,
  MAX_FIELD_VALUE,
  MAX_POLL_DURATION_MINUTES,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LABEL,
  MAX_POLL_QUESTION,
  PollSchema,
  buttonsPath,
  fieldsPath,
};
