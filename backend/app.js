require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

connectDB();

app.get("/api/health", (_, res) => {
  res
    .status(200)
    .json({ success: true, message: "VigilAuth backend is running" });
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/transfer", require("./routes/transfer"));
app.use("/api", require("./routes/riskRoutes"));
app.use("/api/record-session", require("./routes/recordSession"));

const PORT = process.env.PORT || 5000;
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
