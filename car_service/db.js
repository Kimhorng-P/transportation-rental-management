const mongoose = require("mongoose");

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
      enum: ["ACTIVE", "MAINTENANCE", "ARCHIVED"],
      default: "ACTIVE"
    }
  },
  { timestamps: true }
);

// 2. Create the model after defining the schema
const Car = mongoose.model("Car", carSchema, "cars");

// 3. Connect to MongoDB
async function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected");
}

// 4. Export the connection function and model
module.exports = { connectDB, Car };