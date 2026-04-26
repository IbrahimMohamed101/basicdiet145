const { formatInTimeZone } = require("date-fns-tz");
const { processDailyCutoff } = require("../services/automationService");
const {
  processDueDeliveryArrivingSoon,
  processDailyMealSelectionReminders,
  processSubscriptionExpiryReminders,
} = require("../services/notificationSchedulerService");
const { cleanupAbandonedPromoReservations } = require("../services/promoCodeService");
const Setting = require("../models/Setting");
const { KSA_TIMEZONE } = require("../utils/date");
const { logger } = require("../utils/logger");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function startJobs() {
  logger.info("Jobs starting");
  let lastCutoffRunDate = null;
  let lastMealReminderRunDate = null;
  let lastExpiryReminderRunDate = null;
  let lastPromoCleanupRunTime = 0;
  let inProgress = false;

  // Process all recurring jobs every minute in a single guarded loop.
  setInterval(async () => {
    if (inProgress) return;
    inProgress = true;

    try {
      const now = new Date();
      const nowTime = formatInTimeZone(now, KSA_TIMEZONE, "HH:mm");
      const todayKSA = formatInTimeZone(now, KSA_TIMEZONE, "yyyy-MM-dd");

      try {
        await processDueDeliveryArrivingSoon(now);
      } catch (err) {
        logger.error("Arriving soon job failed", { error: err.message, stack: err.stack });
      }

      if (now.getTime() - lastPromoCleanupRunTime >= 15 * 60 * 1000) {
        try {
          const stats = await cleanupAbandonedPromoReservations(60); // 60 mins timeout
          if (stats.totalStale > 0) {
            logger.info("Promo reservations cleanup completed", stats);
          }
          lastPromoCleanupRunTime = now.getTime();
        } catch (err) {
          logger.error("Promo cleanup job failed", { error: err.message, stack: err.stack });
        }
      }

      const cutoffTime = await getSettingValue("cutoff_time", "00:00");
      if (nowTime >= cutoffTime && lastCutoffRunDate !== todayKSA) {
        await processDailyCutoff();
        lastCutoffRunDate = todayKSA;
      }

      if (nowTime >= "22:00" && lastMealReminderRunDate !== todayKSA) {
        await processDailyMealSelectionReminders(now);
        lastMealReminderRunDate = todayKSA;
      }

      if (nowTime >= "09:00" && lastExpiryReminderRunDate !== todayKSA) {
        await processSubscriptionExpiryReminders(now);
        lastExpiryReminderRunDate = todayKSA;
      }
    } catch (err) {
      logger.error("Jobs error", { error: err.message, stack: err.stack });
    } finally {
      inProgress = false;
    }
  }, 60 * 1000);
}

module.exports = { startJobs };
