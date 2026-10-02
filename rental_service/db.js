
const mongoose = require("mongoose");
const Rental = mongoose.model("Rental", rentalSchema, "rentals");
module.export = { connectDB, Car, Booking, Rental }

const rentalSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    carId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Car",
      required: true
    },
    pickupDate: {
      type: Date,
      required: true
    },
    expectedReturnDate: {
      type: Date,
      required: true
    },
    actualReturnDate: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED"],
      default: "ACTIVE"
    }
  },
  { timestamps: true }
);