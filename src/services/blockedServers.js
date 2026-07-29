const BlockedServer = require("@schemas/BlockedServer");

const SERVER_ID_PATTERN = /^\d{17,20}$/;

function isValidServerId(serverId) {
  return SERVER_ID_PATTERN.test(String(serverId || ""));
}

async function getActiveBlock(serverId, { model = BlockedServer, now = new Date() } = {}) {
  const block = await model.findOne({ serverId });
  if (!block) return null;

  if (!block.isPermanent && block.expiresAt && block.expiresAt <= now) {
    await model.deleteOne({ _id: block._id });
    return null;
  }

  return block;
}

async function removeExpiredBlocks({ model = BlockedServer, now = new Date() } = {}) {
  return model.deleteMany({
    isPermanent: false,
    expiresAt: { $lte: now },
  });
}

module.exports = {
  isValidServerId,
  getActiveBlock,
  removeExpiredBlocks,
};
