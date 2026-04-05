const express = require("express");
const router = express.Router();
const { verifySession } = require("../controllers/riskController");

router.post("/verify-session", verifySession);
module.exports = router;
