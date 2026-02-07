const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../middleware/auth");
const { getFirebaseAdmin } = require("../utils/firebase");

async function requestOtp(req, res) {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing phone" } });

  // Firebase Phone Auth OTP is handled on the client side.
  // Backend only verifies the Firebase ID token in verifyOtp.
  res.status(200).json({ ok: true, data: { message: "OTP handled by client via Firebase" } });
}

async function verifyOtp(req, res) {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing idToken" } });

  let decoded;
  try {
    const firebaseAdmin = getFirebaseAdmin();
    decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ ok: false, error: { code: "INVALID_OTP", message: "Invalid Firebase token" } });
  }

  const phone = decoded.phone_number;
  if (!phone) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Phone number not found in token" } });
  }

  let user = await User.findOne({ phone });
  if (!user) {
    user = await User.create({ phone, role: "client" });
  }

  const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: "30d" });

  res.status(200).json({ ok: true, data: { token, user: { id: user._id, phone: user.phone, role: user.role } } });
}

async function updateDeviceToken(req, res) {
  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false, error: { code: "INVALID", message: "Missing token" } });
  }
  await User.findByIdAndUpdate(req.userId, { $addToSet: { fcmTokens: token } });
  return res.status(200).json({ ok: true });
}

module.exports = { requestOtp, verifyOtp, updateDeviceToken };
