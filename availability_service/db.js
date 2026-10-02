const mongoose = require("mongoose");
const Car = mongoose.model("Car", carSchema, "cars");
module.export = { connectDB, Car }

const carSchema = new mongoose.Schema(
  {
    brand: {
      type: String,
      required: true
    },
    model: {
      type: String,
      required: true
    },
    year: {
      type: Number,
      required: true
    },
    color: {
      type: String,
      required: true
    },
    plateNumber: {
      type: String,
      required: true,
      unique: true
    },
    transmission: {
      type: String,
      enum: ["AUTOMATIC", "MANUAL"],
      required: true
    },
    fuelType: {
      type: String,
      enum: ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"],
      required: true
    },
    seats: {
      type: Number,
      required: true,
      min: 1
    },
    pricePerDay: {
      type: Number,
      required: true,
      min: 0.01
    },
    status: {
      type: String,
      enum: ["AVAILABLE", "BOOKED", "RENTED", "MAINTENANCE"],
      default: "AVAILABLE"
    }
  },
  { timestamps: true }
);