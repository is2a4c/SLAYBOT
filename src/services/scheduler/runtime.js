const { Scheduler } = require("./Scheduler");
const tempRoles = require("@src/services/roles/TempRoles");
const reminders = require("@src/services/reminders/Reminders");
const birthdays = require("@src/services/birthdays/Birthdays");
const polls = require("@handlers/polls");
const scheduledEvents = require("@src/services/events/ScheduledEvents");
const forestFuss = require("@src/services/forestFuss/game");

/**
 * Wire every deferred feature into a single durable scheduler and start polling.
 *
 * New feature checklist: add a `register(scheduler)` export next to the feature
 * and list it here. Nothing else needs a timer of its own.
 *
 * @param {import('@src/structures').BotClient} client
 */
function startScheduler(client) {
  const scheduler = new Scheduler({
    client,
    pollIntervalMs: client.config.SCHEDULER?.pollIntervalMs,
    batchSize: client.config.SCHEDULER?.batchSize,
    leaseMs: client.config.SCHEDULER?.leaseMs,
  });

  tempRoles.register(scheduler);
  reminders.register(scheduler);
  birthdays.register(scheduler);
  polls.register(scheduler);
  scheduledEvents.register(scheduler);
  forestFuss.register(scheduler);

  client.scheduler = scheduler;
  return scheduler.start();
}

module.exports = { startScheduler };
