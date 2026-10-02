const mongoose = require("mongoose");
const User = mongoose.model("User", userSchema, "users");
module.export = { connectDB, User }

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: true,
      select: false 
    },
    phone: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ["CUSTOMER", "ADMIN"],
      default: "CUSTOMER"
    }
  },
  { timestamps: true }
);