const mongoose = require("mongoose");

const SettingSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true },
        value: { type: mongoose.Schema.Types.Mixed, required: true },
        // BUSINESS RULE: Global skip allowance defaults to 0, which means users cannot skip any days.
        skipAllowance: { type: Number, default: 0, min: 0 },
        description: { type: String },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Setting", SettingSchema);
