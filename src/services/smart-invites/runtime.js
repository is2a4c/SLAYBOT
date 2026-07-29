const fs = require("fs/promises");
const http = require("http");
const https = require("https");
const { SmartInviteService } = require("./SmartInviteService");
const SmartInviteScheduler = require("./SmartInviteScheduler");
const { createSmartInvitesApp } = require("@src/web/smart-invites/app");

const runtimes = new WeakMap();

async function createSmartInvitesServer(app, config) {
  if (!config.tlsEnabled) return http.createServer(app);
  const tlsOptions = {
    key: await fs.readFile(config.tlsKeyPath),
    cert: await fs.readFile(config.tlsCertPath),
  };
  return https.createServer(tlsOptions, app);
}

async function start(client) {
  if (!client.config.SMART_INVITES.enabled) return null;
  if (runtimes.has(client)) return runtimes.get(client);

  const service = new SmartInviteService(client);
  await service.model.createIndexes();
  await service.recoverExpiredLeases();
  const scheduler = new SmartInviteScheduler(service);
  const app = createSmartInvitesApp(service);
  const runtime = { service, scheduler, app, server: null };
  runtimes.set(client, runtime);

  try {
    const server = await createSmartInvitesServer(app, client.config.SMART_INVITES);
    runtime.server = await new Promise((resolve, reject) => {
      server.listen(client.config.SMART_INVITES.port, client.config.SMART_INVITES.host, () => resolve(server));
      server.once("error", reject);
    });
  } catch (error) {
    runtimes.delete(client);
    throw error;
  }
  scheduler.start();
  client.smartInvites = service;
  client.logger.success(
    `Smart Invites listening on ${client.config.SMART_INVITES.tlsEnabled ? "https" : "http"}://${client.config.SMART_INVITES.host}:${client.config.SMART_INVITES.port}`
  );
  return runtime;
}

async function stop(client, timeoutMs = 5000) {
  const runtime = runtimes.get(client);
  if (!runtime) return;
  await runtime.scheduler.stop(timeoutMs);
  if (runtime.server) {
    await Promise.race([
      new Promise((resolve) => runtime.server.close(resolve)),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }
  runtimes.delete(client);
  delete client.smartInvites;
}

function get(client) {
  return runtimes.get(client) || null;
}

module.exports = {
  start,
  stop,
  get,
  createSmartInvitesServer,
};
