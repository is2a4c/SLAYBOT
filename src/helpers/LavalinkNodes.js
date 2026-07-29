const LOCAL_NODE_ID = "local-lavalink";

function getLavalinkNodes(configuredNodes, env = process.env) {
  const nodes = Array.isArray(configuredNodes) ? [...configuredNodes] : [];
  const password = env.LAVALINK_LOCAL_PASSWORD?.trim();

  if (!password) return nodes;

  const withoutLocal = nodes.filter((node) => {
    const identifier = node?.identifier || node?.id;
    return identifier !== LOCAL_NODE_ID && !(node?.host === "127.0.0.1" && Number(node?.port) === 2333);
  });

  return [
    {
      id: LOCAL_NODE_ID,
      host: "127.0.0.1",
      port: 2333,
      password,
      secure: false,
    },
    ...withoutLocal,
  ];
}

module.exports = {
  LOCAL_NODE_ID,
  getLavalinkNodes,
};
