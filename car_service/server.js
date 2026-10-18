
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { connectDB, Car } = require("./db");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5003;

// 1. Verify JWT token
function authenticate(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({
      message: "Bearer token required"
    });
  }

  try {
    const decoded = jwt.verify(match[1], process.env.JWT_SECRET, {
      algorithms: ["HS256"]
    });

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
}

// 2. Check Admin role
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "Admin access required"
    });
  }

  next();
}

// 3. Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    service: "car_service",
    status: "running"
  });
});

// 4. GET all cars
app.get("/cars", authenticate, async (req, res) => {
  try {
    const cars = await Car.find({
      status: { $ne: "ARCHIVED" }
    });

    res.status(200).json(cars);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve cars"
    });
  }
});

// 5. GET car by ID
app.get("/cars/:id", authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid car ID"
      });
    }

    const car = await Car.findById(req.params.id);

    if (!car || car.status === "ARCHIVED") {
      return res.status(404).json({
        message: "Car not found"
      });
    }

    res.status(200).json(car);
  } catch (error) {
    res.status(500).json({
      message: "Failed to retrieve car"
    });
  }
});

// 6. POST create car (Admin only)
app.post("/cars", authenticate, requireAdmin, async (req, res) => {
  try {
    const car = await Car.create(req.body);

    res.status(201).json({
      message: "Car created successfully",
      car
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Plate number already exists"
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: error.message
      });
    }

    res.status(500).json({
      message: "Failed to create car"
    });
  }
});

// 7. PUT update car (Admin only)
app.put("/cars/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid car ID"
      });
    }

    const allowedFields = [
      "brand",
      "model",
      "year",
      "color",
      "plateNumber",
      "transmission",
      "fuelType",
      "seats",
      "pricePerDay",
      "status"
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const car = await Car.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $ne: "ARCHIVED" }
      },
      { $set: updates },
      {
        new: true,
        runValidators: true
      }
    );

    if (!car) {
      return res.status(404).json({
        message: "Car not found"
      });
    }

    res.status(200).json({
      message: "Car updated successfully",
      car
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Plate number already exists"
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: error.message
      });
    }

    res.status(500).json({
      message: "Failed to update car"
    });
  }
});

// 8. DELETE archive car (Admin only)
app.delete("/cars/:id", authenticate, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid car ID"
      });
    }

    const car = await Car.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $ne: "ARCHIVED" }
      },
      { $set: { status: "ARCHIVED" } },
      { new: true }
    );

    if (!car) {
      return res.status(404).json({
        message: "Car not found"
      });
    }

    res.status(200).json({
      message: "Car archived successfully",
      car
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to archive car"
    });
  }
});

// 9. Start server after connecting to MongoDB
async function startServer() {
  try {
    await connectDB();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Car Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start Car Service:", error.message);
    process.exit(1);
  }
}

startServer();
