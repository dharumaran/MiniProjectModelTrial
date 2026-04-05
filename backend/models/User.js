const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now,
  },
  amount: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    enum: ["Credit", "Debit"],
    required: true,
  },
  mode: {
    type: String,
    default: "UPI",
  },
  counterparty: {
    type: String,
    default: "",
  },
  upiId: {
    type: String,
    default: "",
  },
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    username: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    password: {
      type: String,
    },
    mpinHash: {
      type: String,
      trim: true,
    },
    biometricKey: {
      type: String,
      trim: true,
    },
    accountNo: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    upiId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    bankName: {
      type: String,
      trim: true,
      default: "VigilAuth Bank",
    },
    balance: {
      type: Number,
      default: 10000,
    },
    isRegistered: {
      type: Boolean,
      default: true,
    },
    transactions: {
      type: [transactionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
