const express = require("express");
const {
  signup,
  login,
  getProfile,
  updateUpiId,
} = require("../controllers/authController");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.patch("/upi", updateUpiId);
router.get("/profile/:accountNo", getProfile);

module.exports = router;
