const { formatInTimeZone } = require("date-fns-tz");
const { processDailyCutoff } = require("../services/automationService");
const Setting = require("../models/Setting");
const { KSA_TIMEZONE } = require("../utils/date");
const { logger } = require("../utils/logger");

async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : fallback;
}

function startJobs() {
    logger.info("Jobs starting");
    let lastRunDate = null;

    // Check every minute to run cutoff once per KSA day after the configured time.
    setInterval(async () => {
        try {
            const cutoffTime = await getSettingValue("cutoff_time", "00:00");
            const now = new Date();
            const nowTime = formatInTimeZone(now, KSA_TIMEZONE, "HH:mm");
            const todayKSA = formatInTimeZone(now, KSA_TIMEZONE, "yyyy-MM-dd");

            if (nowTime >= cutoffTime && lastRunDate !== todayKSA) {
                await processDailyCutoff();
                lastRunDate = todayKSA;
            }
        } catch (err) {
            logger.error("Jobs error", { error: err.message, stack: err.stack });
        }
    }, 60 * 1000);
}

module.exports = { startJobs };
