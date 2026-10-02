const mongoose = require("mongoose");
const Booking = mongoose.model("Booking", bookingSchema, "bookings");
module.export = { connectDB, Car, Booking }

const bookingSchema = new mongoose.Schema(
  {
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
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    totalDays: {
      type: Number,
      required: true,
      min: 1
    },
    pricePerDay: {
      type: Number,
      required: true,
      min: 0.01
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0.01
    },
    status: {
      type: String,
      enum: ["CONFIRMED", "CANCELLED", "ACTIVE", "COMPLETED"],
      default: "CONFIRMED"
    }
  },
  { timestamps: true }
);

// Only one confirmed booking per car
bookingSchema.index(
  { carId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "CONFIRMED" }
  }
);