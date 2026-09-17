const mongoose = require("mongoose");
const request = require("supertest");
const { connect, cleanup } = require("./setup/db");
const { seedSettings, seedSubscriptionWithDay, dashboardHeaders, auth, token } = require("./setup/seed");
const { createApp } = require("../src/app");
const { SubscriptionDay } = require("../src/models/subscription");

const TODAY = new Date().toISOString().split("T")[0];

(async function run() {
  try {
    await connect();
    await cleanup();
    await seedSettings();
    const api = request(createApp());

    const { user, subscription, day } = await seedSubscriptionWithDay({
      label: "availability-mixed-items",
      slots: [],
    });

    await SubscriptionDay.updateOne(
      { _id: day._id },
      {
        $set: {
          addonSelections: [
            {
              addonId: new mongoose.Types.ObjectId(),
              key: "berry_juice",
              name: "Berry Juice",
              category: "juice",
              source: "subscription",
              priceHalala: 0,
              currency: "SAR",
            },
          ],
        },
      }
    );

    const res = await api.get(`/api/subscriptions/${subscription._id}/pickup-availability?date=${TODAY}`).set(auth(token(user._id)));
    console.log(JSON.stringify(res.body, null, 2));
  } finally {
    await cleanup();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
