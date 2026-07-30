const mongoose = require("mongoose");
const { log, success, error } = require("../helpers/Logger");

mongoose.set("strictQuery", true);

module.exports = {
  async initializeMongoose() {
    log(`Connecting to MongoDb...`);

    try {
      await mongoose.connect(process.env.MONGO_CONNECTION);

      success("Mongoose: Database connection established");

      return mongoose.connection;
    } catch (err) {
      error("Mongoose: Failed to connect to database", err);
      process.exit(1);
    }
  },

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
    DashboardAuditLog: require("./schemas/DashboardAuditLog"),
    StaffAccount: require("./schemas/StaffAccount").model,
  },
};
