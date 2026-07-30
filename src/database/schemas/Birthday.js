const mongoose = require("mongoose");

const Schema = new mongoose.Schema(
  {
    guild_id: { type: String, required: true },
    user_id: { type: String, required: true },
    day: { type: Number, required: true, min: 1, max: 31 },
    month: { type: Number, required: true, min: 1, max: 12 },
    // Optional: members may share the date without the year.
    year: { type: Number, default: null, min: 1900, max: 2100 },
    // Last time the announcement ran, so a restart cannot double-announce.
    last_announced_year: { type: Number, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1, user_id: 1 }, { unique: true });
Schema.index({ guild_id: 1, month: 1, day: 1 });

const Model = mongoose.models["birthday"] ? mongoose.model("birthday") : mongoose.model("birthday", Schema);

/**
 * 30 February is never a birthday; 29 February is, in leap years.
 * @param {number} day
 * @param {number} month
 */
function isValidDate(day, month) {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12 || day < 1) return false;

  const daysPerMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysPerMonth[month - 1];
}

module.exports = {
  model: Model,
  isValidDate,

  /**
   * @param {{guildId: string, userId: string, day: number, month: number, year?: number|null}} input
   */
  setBirthday: ({ guildId, userId, day, month, year = null }) =>
    Model.findOneAndUpdate(
      { guild_id: guildId, user_id: userId },
      { $set: { day, month, year } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean(),

  getBirthday: (guildId, userId) => Model.findOne({ guild_id: guildId, user_id: userId }).lean(),

  removeBirthday: (guildId, userId) => Model.deleteOne({ guild_id: guildId, user_id: userId }),

  /**
   * @param {{guildId: string, day: number, month: number}} input
   */
  findBirthdaysOn: ({ guildId, day, month }) => Model.find({ guild_id: guildId, day, month }).lean(),

  /**
   * Members whose birthday is still ahead of the given date, in calendar order.
   * @param {{guildId: string, from: Date, limit?: number}} input
   */
  upcomingBirthdays: async ({ guildId, from = new Date(), limit = 10 }) => {
    const all = await Model.find({ guild_id: guildId }).lean();
    const key = (month, day) => month * 100 + day;
    const today = key(from.getUTCMonth() + 1, from.getUTCDate());

    return all
      .map((entry) => ({ ...entry, sortKey: key(entry.month, entry.day) }))
      .sort((a, b) => {
        // Wrap the year so today comes first and past dates go to the end.
        const aKey = a.sortKey < today ? a.sortKey + 1300 : a.sortKey;
        const bKey = b.sortKey < today ? b.sortKey + 1300 : b.sortKey;
        return aKey - bKey;
      })
      .slice(0, limit);
  },

  /**
   * @param {string} guildId
   * @param {string[]} userIds
   * @param {number} year
   */
  markAnnounced: (guildId, userIds, year) =>
    Model.updateMany({ guild_id: guildId, user_id: { $in: userIds } }, { $set: { last_announced_year: year } }),

  deleteGuildBirthdays: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
