const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    form_id: { type: String, required: true },
    guild_id: { type: String, required: true },
    channel_id: String,
    message_id: String,
    response_channel: String,
    title: String,
    description: String,
    button_label: { type: String, default: "Fill the form" },
    questions: [
      {
        _id: false,
        label: String,
        style: {
          type: String,
          enum: ["SHORT", "PARAGRAPH"],
          default: "PARAGRAPH",
        },
        required: { type: Boolean, default: true },
      },
    ],
    created_by: String,
    enabled: { type: Boolean, default: true },
    allow_multiple: { type: Boolean, default: false },
    responses: [
      {
        _id: false,
        user_id: String,
        answers: [
          {
            _id: false,
            question: String,
            answer: String,
          },
        ],
        submitted_at: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

Schema.index({ guild_id: 1, form_id: 1 }, { unique: true });

const Model = mongoose.models["forms"] ? mongoose.model("forms") : mongoose.model("forms", Schema);

module.exports = {
  model: Model,

  /**
   * @param {object} data - the form details
   */
  createForm: async (data) => {
    return new Model(data).save();
  },

  /**
   * @param {string} guildId
   * @param {string} formId
   */
  findForm: async (guildId, formId) => {
    return Model.findOne({ guild_id: guildId, form_id: formId.toLowerCase() });
  },

  /**
   * Returns all forms of a guild without their responses
   * @param {string} guildId
   */
  getForms: async (guildId) => {
    return Model.aggregate([
      { $match: { guild_id: guildId } },
      { $sort: { created_at: -1 } },
      {
        $project: {
          form_id: 1,
          title: 1,
          channel_id: 1,
          enabled: 1,
          responses: { $size: { $ifNull: ["$responses", []] } },
        },
      },
    ]);
  },

  /**
   * @param {string} guildId
   * @param {string} formId
   */
  deleteForm: async (guildId, formId) => {
    return Model.findOneAndDelete({ guild_id: guildId, form_id: formId.toLowerCase() });
  },

  /**
   * @param {string} guildId
   * @param {string} formId
   * @param {string} userId
   */
  hasResponded: async (guildId, formId, userId) => {
    const found = await Model.exists({
      guild_id: guildId,
      form_id: formId.toLowerCase(),
      "responses.user_id": userId,
    });
    return !!found;
  },

  /**
   * @param {string} guildId
   * @param {string} formId
   * @param {string} userId
   * @param {{question: string, answer: string}[]} answers
   */
  addResponse: async (guildId, formId, userId, answers) => {
    return Model.updateOne(
      { guild_id: guildId, form_id: formId.toLowerCase() },
      {
        $push: {
          responses: { user_id: userId, answers, submitted_at: new Date() },
        },
      }
    );
  },
};
