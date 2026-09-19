const AppContent = require("../models/AppContent");

const APP_AD_IMAGE_URL =
  "https://res.cloudinary.com/da8tyika6/image/upload/v1789828097/Gemini_Generated_Image_d4hifgd4hifgd4hi.jpg";

async function seedAppAd() {
  const key = "app_ad";
  const locale = "ar";

  const existing = await AppContent.findOne({ key, locale }).sort({ updatedAt: -1 });

  if (existing) {
    return {
      created: false,
      skipped: true,
      reason: "existing_app_ad",
      isActive: existing.isActive === true,
    };
  }

  await AppContent.create({
    key,
    title: "إعلان التطبيق",
    content: {
      imageUrl: APP_AD_IMAGE_URL,
      linkUrl: null,
      altText: "إعلان BasicDiet",
    },
    locale,
    version: 1,
    isActive: true,
    updatedBy: null,
  });

  return {
    created: true,
    skipped: false,
    isActive: true,
    imageUrl: APP_AD_IMAGE_URL,
  };
}

module.exports = { seedAppAd, APP_AD_IMAGE_URL };
