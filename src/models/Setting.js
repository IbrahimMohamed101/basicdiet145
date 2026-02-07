const mongoose = require("mongoose");

const SettingSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true },
        value: { type: mongoose.Schema.Types.Mixed, required: true },
        description: { type: String },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Setting", SettingSchema);
