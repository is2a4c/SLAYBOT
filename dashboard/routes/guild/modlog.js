const express = require("express");
const router = express.Router();
const { model: ModLogModel } = require("@schemas/ModLog");

const PAGE_SIZE = 25;
const VALID_TYPES = [
  "PURGE",
  "WARN",
  "TIMEOUT",
  "UNTIMEOUT",
  "KICK",
  "SOFTBAN",
  "BAN",
  "UNBAN",
  "VMUTE",
  "VUNMUTE",
  "DEAFEN",
  "UNDEAFEN",
  "DISCONNECT",
  "MOVE",
];

router.get("/", async (req, res) => {
  const { guild } = req;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const type = VALID_TYPES.includes(req.query.type) ? req.query.type : null;
  const memberId = /^\d{17,20}$/.test(req.query.memberId || "") ? req.query.memberId : null;

  const filter = { guild_id: guild.id };
  if (type) filter.type = type;
  if (memberId) filter.member_id = memberId;

  const [entries, total] = await Promise.all([
    ModLogModel.find(filter)
      .sort({ created_at: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    ModLogModel.countDocuments(filter),
  ]);

  res.render("guild/modlog", {
    title: `ModLog — ${guild.name}`,
    guild,
    entries,
    page,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    validTypes: VALID_TYPES,
    filterType: type,
    filterMemberId: memberId,
  });
});

module.exports = router;
