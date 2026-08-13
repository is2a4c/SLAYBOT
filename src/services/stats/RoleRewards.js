function crossedRewards(rewards, before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return [];
  return (rewards || [])
    .filter((reward) => Number(reward.threshold) > before && Number(reward.threshold) <= after)
    .sort((left, right) => Number(left.threshold) - Number(right.threshold));
}

function manageableRoleIds(member, ids) {
  return [...new Set(ids || [])].filter((id) => {
    const role = member.guild.roles.cache.get(id);
    return role && role.id !== member.guild.id && !role.managed && role.editable !== false;
  });
}

async function applyRoleRewards(member, rewards, before, after) {
  const crossed = crossedRewards(rewards, before, after);
  if (!crossed.length) return { crossed: 0, added: [], removed: [] };

  const add = manageableRoleIds(
    member,
    crossed.flatMap((reward) => reward.add_roles || [])
  );
  const remove = manageableRoleIds(
    member,
    crossed.flatMap((reward) => reward.remove_roles || [])
  ).filter((id) => !add.includes(id));

  if (remove.length) await member.roles.remove(remove, "SLAYBOT ranking reward");
  if (add.length) await member.roles.add(add, "SLAYBOT ranking reward");
  return { crossed: crossed.length, added: add, removed: remove };
}

module.exports = { applyRoleRewards, crossedRewards, manageableRoleIds };
