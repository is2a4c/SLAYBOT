const mongoose = require("mongoose");
const { log, success, warn, error } = require("../helpers/Logger");

mongoose.set("strictQuery", true);

/**
 * How the bot talks to a database it reaches over the internet.
 *
 * The driver's own defaults are written for a service that can wait: half a
 * minute to pick a server, and no limit on a socket that has stopped answering.
 * A click has three seconds, so a network hiccup on the way to Atlas has to end
 * in a refusal the panel can show rather than in an interaction Discord gives up
 * on — and the pool has to be wide enough that one slow read is not everybody's
 * slow read.
 */
const CONNECTION = {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  heartbeatFrequencyMS: 15000,
  maxPoolSize: 20,
  minPoolSize: 2,
  maxIdleTimeMS: 60000,
};

// Losing the database and getting it back is worth one line each: without them a
// stretch of slow commands has nothing in the log to explain it.
let watching = false;
function watch(connection) {
  if (watching) return;
  watching = true;

  connection.on("disconnected", () => warn("Mongoose: connection lost, retrying"));
  connection.on("reconnected", () => success("Mongoose: connection back"));
  connection.on("error", (err) => error("Mongoose: connection error", err));
}

module.exports = {
  async initializeMongoose() {
    log(`Connecting to MongoDb...`);

    try {
      await mongoose.connect(process.env.MONGO_CONNECTION, CONNECTION);

      success("Mongoose: Database connection established");
      watch(mongoose.connection);

      return mongoose.connection;
    } catch (err) {
      error("Mongoose: Failed to connect to database", err);
      process.exit(1);
    }
  },

  CONNECTION,

  schemas: {
    Birthday: require("./schemas/Birthday").model,
    Feed: require("./schemas/Feed").model,
    Giveaways: require("./schemas/Giveaways"),
    Guild: require("./schemas/Guild"),
    GuildBackup: require("./schemas/GuildBackup").model,
    Member: require("./schemas/Member"),
    MemberRoles: require("./schemas/MemberRoles").model,
    ModmailThread: require("./schemas/ModmailThread").model,
    Poll: require("./schemas/Poll").model,
    ReactionRoles: require("./schemas/ReactionRoles").model,
    ScheduledTask: require("./schemas/ScheduledTask").model,
    SelfRolePanel: require("./schemas/SelfRolePanel").model,
    StarboardEntry: require("./schemas/StarboardEntry").model,
    StickyMessage: require("./schemas/StickyMessage").model,
    ModLog: require("./schemas/ModLog").model,
    TranslateLog: require("./schemas/TranslateLog").model,
    User: require("./schemas/User"),
    Suggestions: require("./schemas/Suggestions").model,
    BlockedServer: require("./schemas/BlockedServer"),
    SlayNode: require("./schemas/slaynode"),
    SmartInvite: require("./schemas/SmartInvite"),
    SmartInviteControl: require("./schemas/SmartInviteControl"),
    VerificationAttempt: require("./schemas/VerificationAttempt").model,
    TelemetryBucket: require("./schemas/TelemetryBucket"),
    TelemetryActor: require("./schemas/TelemetryActor"),
    DashboardAuditLog: require("./schemas/DashboardAuditLog"),
    StaffAccount: require("./schemas/StaffAccount").model,
  },
};
