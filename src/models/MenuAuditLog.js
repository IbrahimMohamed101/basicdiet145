const mongoose = require("mongoose");

const MenuAuditLogSchema = new mongoose.Schema(
  {
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    action: { type: String, required: true, index: true },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    actorRole: { type: String, default: "" },
    versionId: { type: mongoose.Schema.Types.ObjectId, ref: "MenuVersion", default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

MenuAuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
MenuAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("MenuAuditLog", MenuAuditLogSchema);
