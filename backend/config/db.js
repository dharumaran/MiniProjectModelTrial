const mongoose = require("mongoose");
const User = require("../models/User");

const mongoUri =
  process.env.MONGODB_URI ||
  "mongodb://MiniProject:Mini_Project123@ac-zzx241z-shard-00-00.vrfqc0c.mongodb.net:27017,ac-zzx241z-shard-00-01.vrfqc0c.mongodb.net:27017,ac-zzx241z-shard-00-02.vrfqc0c.mongodb.net:27017/?ssl=true&replicaSet=atlas-tht0f9-shard-0&authSource=admin&appName=Mini";

const connectDB = async () => {
  try {
    mongoose.set("bufferCommands", false);

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    await User.syncIndexes();
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
