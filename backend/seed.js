const mongoose = require("mongoose");
const connectDB = require("./config/db");
const User = require("./models/User");

const seed = async () => {
  try {
    await connectDB();

    const dummyUsers = [
      {
        name: "Divya Dharshini R",
        username: "Divya Dharshini R",
        email: "divya@example.com",
        phone: "9000000001",
        biometricKey: "bio-1234567890",
        accountNo: "1234567890",
        upiId: "divya@upi",
        bankName: "SBI",
        balance: 45210,
        transactions: [
          {
            date: new Date("2025-06-01"),
            amount: 5000,
            description: "Salary",
            type: "Credit",
            mode: "NEFT",
            counterparty: "Employer",
          },
          {
            date: new Date("2025-06-10"),
            amount: 1500,
            description: "Electricity Bill",
            type: "Debit",
            mode: "UPI",
            counterparty: "BESCOM",
            upiId: "bescom@upi",
          },
        ],
      },
      {
        name: "Aarav Mehta",
        username: "Aarav Mehta",
        email: "aarav@example.com",
        phone: "9000000002",
        biometricKey: "bio-9876543210",
        accountNo: "9876543210",
        upiId: "aarav@upi",
        bankName: "HDFC",
        balance: 30000,
        transactions: [
          {
            date: new Date("2025-06-03"),
            amount: 10000,
            description: "Freelance Project",
            type: "Credit",
            mode: "IMPS",
            counterparty: "Client",
          },
          {
            date: new Date("2025-06-07"),
            amount: 2000,
            description: "Groceries",
            type: "Debit",
            mode: "UPI",
            counterparty: "Fresh Mart",
            upiId: "freshmart@upi",
          },
        ],
      },
      {
        name: "Meera Nair",
        username: "Meera Nair",
        email: "meera@example.com",
        phone: "9000000003",
        biometricKey: "bio-1122334455",
        accountNo: "1122334455",
        upiId: "meera@upi",
        bankName: "ICICI",
        balance: 75000,
        transactions: [
          {
            date: new Date("2025-06-05"),
            amount: 20000,
            description: "Bonus",
            type: "Credit",
            mode: "NEFT",
            counterparty: "Employer",
          },
          {
            date: new Date("2025-06-12"),
            amount: 3000,
            description: "Rent",
            type: "Debit",
            mode: "UPI",
            counterparty: "Landlord",
            upiId: "landlord@upi",
          },
        ],
      },
    ];

    await User.deleteMany({});
    await User.insertMany(dummyUsers);
    console.log("All dummy users added to database");
  } catch (error) {
    console.error("Error inserting dummy users:", error);
  } finally {
    await mongoose.disconnect();
  }
};

seed();
