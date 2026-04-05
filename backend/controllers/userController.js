const User = require("../models/User");

exports.signup = async (req, res) => {
  const { accountNo } = req.body;

  try {
    const user = await User.findOne({ accountNo });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Account not found" });
    }

    // Remove sensitive fields before sending
    const userSafe = {
      username: user.username,
      accountNo: user.accountNo,
      bankName: user.bankName,
      balance: user.balance,
      transactions: user.transactions,
    };

    return res.status(200).json({ success: true, user: userSafe });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
