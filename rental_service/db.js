const mongoose = require("mongoose");

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

rentalSchema.index(
  { carId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ACTIVE" }
  }
);

const Rental = mongoose.model("Rental", rentalSchema, "rentals");

async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected");
}

module.exports = { connectDB, Rental };