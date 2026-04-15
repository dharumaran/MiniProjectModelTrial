const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");

const router = express.Router();

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

router.post("/", async (req, res) => {
  const { fromAccount, toUpiId, toIdentifier, recipientType, amount, description, mpin } =
    req.body;
  const parsedAmount = Number(amount);
  const rawRecipient = String(toIdentifier || toUpiId || "").trim();
  const normalizedRecipientType = String(recipientType || "auto").toLowerCase();

  if (!fromAccount || !rawRecipient || !parsedAmount || parsedAmount <= 0 || !mpin) {
    return res.status(400).json({
      success: false,
      message:
        "From account, recipient identifier (UPI/account/mobile), MPIN, and a valid amount are required.",
    });
  }
  if (!/^\d{4}$/.test(String(mpin).trim())) {
    return res.status(400).json({
      success: false,
      message: "MPIN must be exactly 4 digits.",
    });
  }

  try {
    const sender = await User.findOne({ accountNo: String(fromAccount).trim() });
    const normalizedRecipient = rawRecipient.toLowerCase();
    const normalizedRecipientPhone = rawRecipient.replace(/\D/g, "");
    let receiver = null;

    if (normalizedRecipientType === "upi") {
      receiver = await User.findOne({ upiId: normalizedRecipient });
    } else if (normalizedRecipientType === "account") {
      receiver = await User.findOne({ accountNo: rawRecipient });
    } else if (normalizedRecipientType === "mobile") {
      receiver = await User.findOne({
        $or: [{ phone: normalizedRecipientPhone }, { phone: rawRecipient }],
      });
    } else {
      const isUpi = normalizedRecipient.includes("@");
      if (isUpi) {
        receiver = await User.findOne({ upiId: normalizedRecipient });
      } else {
        receiver =
          (await User.findOne({ accountNo: rawRecipient })) ||
          (await User.findOne({
            $or: [{ phone: normalizedRecipientPhone }, { phone: rawRecipient }],
          })) ||
          (await User.findOne({ upiId: normalizedRecipient }));
      }
    }

    if (!sender) {
      return res.status(404).json({
        success: false,
        message: "Sender account not found.",
      });
    }
    if (!verifyMpinHash(String(mpin).trim(), sender.mpinHash)) {
      return res.status(401).json({
        success: false,
        message: "Invalid MPIN.",
      });
    }

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "Recipient not found. Check UPI ID, account number, or mobile number.",
      });
    }

    if (sender.accountNo === receiver.accountNo) {
      return res.status(400).json({
        success: false,
        message: "You cannot transfer money to the same account.",
      });
    }

    if (sender.balance < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance.",
      });
    }

    const note = description ? String(description).trim() : "UPI transfer";
    const now = new Date();

    const senderTxn = {
      date: now,
      amount: parsedAmount,
      description: note,
      type: "Debit",
      mode:
        normalizedRecipientType === "mobile"
          ? "Mobile"
          : normalizedRecipientType === "account"
            ? "Account"
            : "UPI",
      counterparty:
        receiver.name ||
        receiver.username ||
        receiver.upiId ||
        receiver.accountNo ||
        receiver.phone,
      upiId: receiver.upiId || "",
    };

    const receiverTxn = {
      date: now,
      amount: parsedAmount,
      description: note,
      type: "Credit",
      mode:
        normalizedRecipientType === "mobile"
          ? "Mobile"
          : normalizedRecipientType === "account"
            ? "Account"
            : "UPI",
      counterparty:
        sender.name ||
        sender.username ||
        sender.upiId ||
        sender.accountNo ||
        sender.phone,
      upiId: sender.upiId || "",
    };

    const updatedSender = await User.findOneAndUpdate(
      {
        _id: sender._id,
        balance: { $gte: parsedAmount },
      },
      {
        $inc: { balance: -parsedAmount },
        $push: { transactions: { $each: [senderTxn], $position: 0 } },
      },
      {
        new: true,
      }
    );

    if (!updatedSender) {
      return res.status(409).json({
        success: false,
        message:
          "Transfer could not be completed due to a concurrent balance update. Please retry.",
      });
    }

    await User.updateOne(
      { _id: receiver._id },
      {
        $inc: { balance: parsedAmount },
        $push: { transactions: { $each: [receiverTxn], $position: 0 } },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Transfer successful.",
      sender: {
        accountNo: updatedSender.accountNo,
        balance: updatedSender.balance,
        transactions: updatedSender.transactions,
      },
      receiver: {
        accountNo: receiver.accountNo,
        upiId: receiver.upiId,
      },
    });
  } catch (err) {
    console.error("Transfer error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during transfer.",
    });
  }
});

module.exports = router;
