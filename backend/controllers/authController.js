const User = require("../models/User");
const crypto = require("crypto");

function hashMpin(mpin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(mpin), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyMpinHash(mpin, storedValue) {
  if (!storedValue || !storedValue.includes(":")) {
    return false;
  }
  const [salt, expectedHash] = storedValue.split(":");
  if (!salt || !expectedHash) {
    return false;
  }
  const actualHash = crypto.scryptSync(String(mpin), salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name || user.username || "",
    email: user.email || "",
    phone: user.phone || "",
    accountNo: user.accountNo,
    upiId: user.upiId || "",
    bankName: user.bankName,
    balance: user.balance,
    transactions: user.transactions
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}

exports.signup = async (req, res) => {
  const { name, email, phone, accountNo, upiId, bankName, mpin } = req.body;

  if (!name || !accountNo || !mpin) {
    return res.status(400).json({
      success: false,
      message: "Name, account number, and MPIN are required.",
    });
  }
  if (!/^\d{4}$/.test(String(mpin).trim())) {
    return res.status(400).json({
      success: false,
      message: "MPIN must be exactly 4 digits.",
    });
  }

  try {
    const normalizedAccountNo = String(accountNo).trim();
    const normalizedUpiId = upiId ? String(upiId).trim().toLowerCase() : "";
    const normalizedPhone = phone ? String(phone).replace(/\D/g, "") : "";

    if (normalizedUpiId) {
      const existingUpiUser = await User.findOne({
        upiId: normalizedUpiId,
        accountNo: { $ne: normalizedAccountNo },
      });

      if (existingUpiUser) {
        return res.status(409).json({
          success: false,
          message: "This UPI ID is already linked to another account.",
        });
      }
    }

    let user = await User.findOne({ accountNo: normalizedAccountNo });

    if (!user) {
      const newUserData = {
        name: String(name).trim(),
        username: String(name).trim(),
        email: email ? String(email).trim().toLowerCase() : "",
        phone: normalizedPhone || (phone ? String(phone).trim() : ""),
        accountNo: normalizedAccountNo,
        bankName: bankName ? String(bankName).trim() : "VigilAuth Bank",
        biometricKey: `bio-${normalizedAccountNo}`,
        mpinHash: hashMpin(String(mpin).trim()),
        balance: 10000,
        isRegistered: true,
      };

      if (normalizedUpiId) {
        newUserData.upiId = normalizedUpiId;
      }

      user = new User(newUserData);
    } else {
      user.name = String(name).trim();
      user.username = String(name).trim();
      user.email = email ? String(email).trim().toLowerCase() : user.email;
      user.phone = normalizedPhone || (phone ? String(phone).trim() : user.phone);
      if (normalizedUpiId) {
        user.upiId = normalizedUpiId;
      } else if (user.upiId === "") {
        user.upiId = undefined;
      }
      user.bankName = bankName ? String(bankName).trim() : user.bankName;
      user.biometricKey = user.biometricKey || `bio-${user.accountNo}`;
      user.mpinHash = hashMpin(String(mpin).trim());
      user.isRegistered = true;
    }

    await user.save();

    return res.status(201).json({
      success: true,
      message: "Signup successful.",
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Signup error:", err);
    if (err.code === 11000 && err.keyPattern?.upiId) {
      return res.status(409).json({
        success: false,
        message: "This UPI ID is already linked to another account.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Server error during signup.",
    });
  }
};

exports.updateUpiId = async (req, res) => {
  const { accountNo, upiId, mpin } = req.body;

  if (!accountNo || !upiId || !mpin) {
    return res.status(400).json({
      success: false,
      message: "Account number, UPI ID, and MPIN are required.",
    });
  }
  if (!/^\d{4}$/.test(String(mpin).trim())) {
    return res.status(400).json({
      success: false,
      message: "MPIN must be exactly 4 digits.",
    });
  }

  try {
    const normalizedAccountNo = String(accountNo).trim();
    const normalizedUpiId = String(upiId).trim().toLowerCase();

    const existingUpiUser = await User.findOne({
      upiId: normalizedUpiId,
      accountNo: { $ne: normalizedAccountNo },
    });

    if (existingUpiUser) {
      return res.status(409).json({
        success: false,
        message: "This UPI ID is already linked to another account.",
      });
    }

    const user = await User.findOne({ accountNo: normalizedAccountNo });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }
    if (!verifyMpinHash(String(mpin).trim(), user.mpinHash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid MPIN.",
      });
    }

    user.upiId = normalizedUpiId;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "UPI ID linked successfully.",
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("UPI update error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while saving UPI ID.",
    });
  }
};

exports.login = async (req, res) => {
  const { accountNo, phone, identifier, mpin } = req.body;
  const loginIdentifier = String(identifier || accountNo || phone || "").trim();

  if (!loginIdentifier || !mpin) {
    return res.status(400).json({
      success: false,
      message: "Account number or phone number and MPIN are required.",
    });
  }
  if (!/^\d{4}$/.test(String(mpin).trim())) {
    return res.status(400).json({
      success: false,
      message: "MPIN must be exactly 4 digits.",
    });
  }

  try {
    const normalizedPhone = loginIdentifier.replace(/\D/g, "");
    const loginCandidates = [{ accountNo: loginIdentifier }];

    if (normalizedPhone) {
      loginCandidates.push({ phone: normalizedPhone }, { phone: loginIdentifier });

      // Match legacy phone formats in DB (e.g. +91-98765 43210)
      loginCandidates.push({
        phone: { $regex: `${normalizedPhone}$` },
      });

      if (normalizedPhone.length > 10) {
        const lastTenDigits = normalizedPhone.slice(-10);
        loginCandidates.push(
          { phone: lastTenDigits },
          { phone: { $regex: `${lastTenDigits}$` } }
        );
      }
    }

    const user = await User.findOne({ $or: loginCandidates });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found. Check account number or phone and try again.",
      });
    }
    if (!verifyMpinHash(String(mpin).trim(), user.mpinHash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid MPIN.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during login.",
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findOne({
      accountNo: String(req.params.accountNo).trim(),
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching user.",
    });
  }
};
