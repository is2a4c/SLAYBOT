const mongoose = require("mongoose");

// TRANSITIONING is internal only, never rendered - the phase a session sits
// in for the instant between claiming a transition and finishing it, so a
// second caller racing the same deadline (a manual skip landing right as the
// scheduler fires) sees a phase mismatch and backs off instead of double-processing.
const PHASES = ["RECRUITMENT", "DAY", "NIGHT", "RESULT", "TRANSITIONING"];
const ROLES = ["WOLF", "VILLAGER"];
const TEAMS = ["WOLVES", "VILLAGERS"];

const Schema = new mongoose.Schema(
  {
    // The lobby channel id doubles as the session id - one game per lobby,
    // and a lookup by channel is exactly what every interaction needs.
    _id: { type: String, required: true },
    guild_id: { type: String, required: true },
    leader_id: { type: String, required: true },
    wolves_channel_id: { type: String, default: null },
    message_id: { type: String, default: null },
    phase: { type: String, enum: PHASES, default: "RECRUITMENT" },
    phase_ends_at: { type: Date, default: null },
    round: { type: Number, default: 0 },
    players: [
      {
        _id: false,
        user_id: { type: String, required: true },
        role: { type: String, enum: ROLES, default: null },
        alive: { type: Boolean, default: true },
      },
    ],
    votes: [
      {
        _id: false,
        voter_id: { type: String, required: true },
        target_id: { type: String, required: true },
      },
    ],
    winner: { type: String, enum: [...TEAMS, null], default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

Schema.index({ guild_id: 1 });

const Model = mongoose.models["forest-fuss-session"]
  ? mongoose.model("forest-fuss-session")
  : mongoose.model("forest-fuss-session", Schema);

module.exports = {
  model: Model,
  PHASES,
  ROLES,
  TEAMS,

  /**
   * @param {{lobbyChannelId: string, guildId: string, leaderId: string}} input
   */
  createSession: ({ lobbyChannelId, guildId, leaderId }) =>
    Model.create({
      _id: lobbyChannelId,
      guild_id: guildId,
      leader_id: leaderId,
      players: [{ user_id: leaderId }],
    }),

  /**
   * @param {string} lobbyChannelId
   */
  getSession: (lobbyChannelId) => Model.findById(lobbyChannelId),

  /**
   * Atomically claim the transition out of `fromPhase`, so only one caller -
   * a manual skip or the scheduled deadline, whichever gets there first -
   * ever processes it.
   *
   * @param {string} lobbyChannelId
   * @param {string} fromPhase
   */
  claimPhaseTransition: (lobbyChannelId, fromPhase) =>
    Model.findOneAndUpdate(
      { _id: lobbyChannelId, phase: fromPhase },
      { $set: { phase: "TRANSITIONING" } },
      { new: true }
    ),

  /**
   * @param {string} guildId
   */
  countActiveSessions: (guildId) => Model.countDocuments({ guild_id: guildId }),

  /**
   * The session a member is already part of on this server, if any - a
   * member may only ever be in one Forest Fuss game at a time.
   *
   * @param {string} guildId
   * @param {string} userId
   */
  findSessionForMember: (guildId, userId) => Model.findOne({ guild_id: guildId, "players.user_id": userId }),

  /**
   * @param {string} lobbyChannelId
   */
  deleteSession: (lobbyChannelId) => Model.deleteOne({ _id: lobbyChannelId }),

  /**
   * @param {string} guildId
   */
  listActiveSessions: (guildId) => Model.find({ guild_id: guildId }),

  /**
   * @param {string} guildId
   */
  deleteGuildSessions: (guildId) => Model.deleteMany({ guild_id: guildId }),
};
