require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { connectDB, Rental } = require("./db");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5006;

// JWT Authentication
function authenticate(req, res, next) {
  const authorization = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({
      message: "Bearer token required"
    });
  }

  try {
    const decoded = jwt.verify(
      match[1],
      process.env.JWT_SECRET,
      { algorithms: ["HS256"] }
    );

    if (
      !decoded ||
      typeof decoded !== "object" ||
      !["admin", "user"].includes(decoded.role) ||
      !mongoose.isValidObjectId(decoded.id)
    ) {
      return res.status(401).json({
        message: "Invalid token"
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
}

// Role Authorization
function authorize(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        message: "Unauthorized"
      });
    }
    next();
  };
}

// Health Check
app.get("/health", (req, res) => {
  return res.status(200).json({
    service: "rental_service",
    status: "running"
  });
});

// POST /rentals
// Admin Only - Start rental from confirmed booking
app.post(
  "/rentals",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    const { bookingId } = req.body || {};

    if (!mongoose.isValidObjectId(bookingId)) {
      return res.status(400).json({
        message: "Valid bookingId is required"
      });
    }

    try {
      let createdRental;

      await mongoose.connection.transaction(async (session) => {
        const booking = await mongoose.connection.db
          .collection("bookings")
          .findOne(
            { _id: new mongoose.Types.ObjectId(bookingId) },
            { session }
          );

        if (!booking) {
          const error = new Error("Booking not found");
          error.httpStatus = 404;
          throw error;
        }

        if (booking.status !== "CONFIRMED") {
          const error = new Error("Booking is not confirmed");
          error.httpStatus = 409;
          throw error;
        }

        const existingRental = await Rental.findOne({
          bookingId: booking._id
        }).session(session);

        if (existingRental) {
          const error = new Error(
            "Rental already exists for this booking"
          );
          error.httpStatus = 409;
          throw error;
        }

        const car = await mongoose.connection.db
          .collection("cars")
          .findOne({ _id: booking.carId }, { session });

        if (!car || car.status !== "ACTIVE") {
          const error = new Error("Car is not active");
          error.httpStatus = 409;
          throw error;
        }

        if (
          !(booking.startDate instanceof Date) ||
          !(booking.endDate instanceof Date) ||
          booking.endDate <= booking.startDate
        ) {
          const error = new Error("Invalid booking dates");
          error.httpStatus = 400;
          throw error;
        }

        const rentals = await Rental.create(
          [{
            bookingId: booking._id,
            customerId: booking.customerId,
            carId: booking.carId,
            pickupDate: booking.startDate,
            expectedReturnDate: booking.endDate,
            status: "ACTIVE"
          }],
          { session }
        );

        createdRental = rentals[0];

        // Write to the booking document too, so concurrent
        // cancellation transactions conflict and retry.
        await mongoose.connection.db
          .collection("bookings")
          .updateOne(
            { _id: booking._id, status: "CONFIRMED" },
            { $set: { rentalStartedAt: new Date() } },
            { session }
          );
      });

      return res.status(201).json({
        message: "Rental started successfully",
        rental: createdRental
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: "Booking or car already has a rental"
        });
      }

      if (error.httpStatus) {
        return res.status(error.httpStatus).json({
          message: error.message
        });
      }

      console.error("Create rental failed:", error);
      return res.status(500).json({
        message: "Unable to start rental"
      });
    }
  }
);

// GET /rentals
// Admin Only
app.get(
  "/rentals",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const rentals = await Rental.find()
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        message: "Rentals retrieved successfully",
        count: rentals.length,
        rentals
      });
    } catch (error) {
      console.error("Get rentals failed:", error);
      return res.status(500).json({
        message: "Unable to retrieve rentals"
      });
    }
  }
);

// GET /rentals/my
// User Only
app.get(
  "/rentals/my",
  authenticate,
  authorize("user"),
  async (req, res) => {
    try {
      const rentals = await Rental.find({
        customerId: req.user.id
      })
        .sort({ createdAt: -1 })
        .lean();

      return res.status(200).json({
        message: "My rentals retrieved successfully",
        count: rentals.length,
        rentals
      });
    } catch (error) {
      console.error("Get my rentals failed:", error);
      return res.status(500).json({
        message: "Unable to retrieve my rentals"
      });
    }
  }
);

// GET /rentals/:id
// Admin or Rental Owner
app.get("/rentals/:id", authenticate, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      message: "Invalid rental ID"
    });
  }

  try {
    const rental = await Rental.findById(req.params.id);

    if (!rental) {
      return res.status(404).json({
        message: "Rental not found"
      });
    }

    if (
      req.user.role !== "admin" &&
      rental.customerId.toString() !== req.user.id
    ) {
      return res.status(403).json({
        message: "Unauthorized"
      });
    }

    return res.status(200).json(rental);
  } catch (error) {
    console.error("Get rental failed:", error);
    return res.status(500).json({
      message: "Unable to retrieve rental"
    });
  }
});

// PATCH /rentals/:id/return
// Admin Only - Complete rental
app.patch(
  "/rentals/:id/return",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid rental ID"
      });
    }

    try {
      const rental = await Rental.findOneAndUpdate(
        {
          _id: req.params.id,
          status: "ACTIVE"
        },
        {
          $set: {
            status: "COMPLETED",
            actualReturnDate: new Date()
          }
        },
        {
          new: true,
          runValidators: true
        }
      );

      if (!rental) {
        const existing = await Rental.findById(req.params.id);

        return res.status(existing ? 409 : 404).json({
          message: existing
            ? "Rental is already completed"
            : "Rental not found"
        });
      }

      return res.status(200).json({
        message: "Rental completed successfully",
        rental
      });
    } catch (error) {
      console.error("Return rental failed:", error);
      return res.status(500).json({
        message: "Unable to complete rental"
      });
    }
  }
);

// Unknown Endpoints
app.use((req, res) => {
  return res.status(404).json({
    message: "Endpoint not found"
  });
});

// Start Rental Service
async function startServer() {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing");
    }

    await connectDB();

    // Ensure unique rental constraints exist before accepting requests
    await Rental.init();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Rental Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start Rental Service:", error.message);
    process.exit(1);
  }
}

startServer();
