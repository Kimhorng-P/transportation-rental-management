const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { connectDB, Booking } = require("./db");

require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5005;


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


// Date Validation

function parseDate(value) {
    if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
    ) {
        return null;
    }

    const date = new Date(value + "T00:00:00.000Z");

    if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
    ) {
        return null;
    }

    return date;
}


function validateDates(startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (!start || !end) {
        return {
            error: "Dates must use YYYY-MM-DD format"
        };
    }

    if (end <= start) {
        return {
            error: "endDate must be after startDate"
        };
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    if (start < today) {
        return {
            error: "startDate cannot be in the past"
        };
    }

    const totalDays = Math.round(
        (end.getTime() - start.getTime()) / 86400000
    );

    if (totalDays > 90) {
        return {
            error: "Booking cannot exceed 90 days"
        };
    }

    return { start, end, totalDays };
}


// Booking and Rental Conflict Check

async function checkConflict(carId, start, end, session) {

    // Check overlapping confirmed bookings
    const existingBooking = await Booking.findOne({
        carId,
        status: "CONFIRMED",
        startDate: { $lt: end },
        endDate: { $gt: start }
    }).session(session);

    if (existingBooking) {
        return "Car is already booked for these dates";
    }

    // Check all active rentals
    const activeRentals = await mongoose.connection.db
        .collection("rentals")
        .find(
            {
                carId,
                status: "ACTIVE",
                actualReturnDate: null
            },
            { session }
        )
        .toArray();

    const now = new Date();

    for (const rental of activeRentals) {
        const pickup = rental.pickupDate;
        const expected = rental.expectedReturnDate;

        if (
            !(pickup instanceof Date) ||
            !(expected instanceof Date) ||
            !Number.isFinite(pickup.getTime()) ||
            !Number.isFinite(expected.getTime()) ||
            expected <= now ||
            (pickup < end && expected > start)
        ) {
            return "Car is rented, overdue, or has incomplete rental dates";
        }
    }

    return null;
}


// Create Booking
// POST /booking
// User Only

app.post(
    "/booking",
    authenticate,
    authorize("user"),
    async (req, res) => {

        const { carId, startDate, endDate } = req.body || {};

        if (
            typeof carId !== "string" ||
            !mongoose.isValidObjectId(carId)
        ) {
            return res.status(400).json({
                message: "Valid carId is required"
            });
        }

        const validation = validateDates(
            startDate,
            endDate
        );

        if (validation.error) {
            return res.status(400).json({
                message: validation.error
            });
        }

        const { start, end, totalDays } = validation;

        const carObjectId = new mongoose.Types.ObjectId(carId);
        const customerId = new mongoose.Types.ObjectId(req.user.id);

        try {
            let createdBooking;

            // Booking and date locks are saved together.
            // If one operation fails, the transaction rolls back.
            await mongoose.connection.transaction(async (session) => {

                // Find selected car
                const car = await mongoose.connection.db
                    .collection("cars")
                    .findOne(
                        { _id: carObjectId },
                        { session }
                    );

                if (!car) {
                    const error = new Error("Car not found");
                    error.httpStatus = 404;
                    throw error;
                }

                // Only ACTIVE cars can be booked
                if (car.status !== "ACTIVE") {
                    const error = new Error(
                        "Car is under maintenance or archived"
                    );
                    error.httpStatus = 409;
                    throw error;
                }

                // Validate the price stored in MongoDB
                if (
                    typeof car.pricePerDay !== "number" ||
                    !Number.isFinite(car.pricePerDay) ||
                    car.pricePerDay <= 0
                ) {
                    const error = new Error("Invalid car price");
                    error.httpStatus = 400;
                    throw error;
                }

                // Check booking and rental conflicts
                const conflict = await checkConflict(
                    carObjectId,
                    start,
                    end,
                    session
                );

                if (conflict) {
                    const error = new Error(conflict);
                    error.httpStatus = 409;
                    throw error;
                }

                // Generate booking ID before creating date locks
                const bookingId = new mongoose.Types.ObjectId();

                // Create one lock for each booked day
                const locks = [];

                for (let i = 0; i < totalDays; i++) {
                    const day = new Date(
                        start.getTime() + i * 86400000
                    );

                    locks.push({
                        carId: carObjectId,
                        day,
                        customerId,
                        bookingId
                    });
                }

                // Prevent overlapping reservations
                await mongoose.connection.db
                    .collection("booking_date_locks")
                    .insertMany(locks, {
                        session,
                        ordered: true
                    });

                // Calculate rental price
                const pricePerDay = car.pricePerDay;

                const totalPrice = Math.round(
                    pricePerDay * totalDays * 100
                ) / 100;

                // Create booking using the same booking ID
                const bookings = await Booking.create([{
                    _id: bookingId,
                    customerId,
                    carId: carObjectId,
                    startDate: start,
                    endDate: end,
                    totalDays,
                    pricePerDay,
                    totalPrice,
                    status: "CONFIRMED"
                }], { session });

                createdBooking = bookings[0];
            });

            return res.status(201).json({
                message: "Booking created successfully",
                booking: createdBooking
            });

        } catch (error) {

            // Duplicate car/day lock
            if (error.code === 11000) {
                return res.status(409).json({
                    message: "Car is already reserved for these dates"
                });
            }

            if (error.httpStatus) {
                return res.status(error.httpStatus).json({
                    message: error.message
                });
            }

            console.error("Booking creation failed:", error);

            return res.status(500).json({
                message: "Unable to create booking"
            });
        }
    }
);


// View All Bookings
// GET /booking
// Admin Only

app.get(
    "/booking",
    authenticate,
    authorize("admin"),
    async (req, res) => {
        try {
            const bookings = await Booking.find()
                .sort({ createdAt: -1 })
                .lean();

            return res.status(200).json({
                message: "Bookings retrieved successfully",
                count: bookings.length,
                bookings
            });

        } catch (error) {
            console.error("View bookings failed:", error);

            return res.status(500).json({
                message: "Unable to retrieve bookings"
            });
        }
    }
);


// View My Bookings
// GET /booking/my
// User Only

app.get(
    "/booking/my",
    authenticate,
    authorize("user"),
    async (req, res) => {
        try {
            const bookings = await Booking.find({
                customerId: req.user.id
            })
                .sort({ createdAt: -1 })
                .lean();

            return res.status(200).json({
                message: "My bookings retrieved successfully",
                count: bookings.length,
                bookings
            });

        } catch (error) {
            console.error("View my bookings failed:", error);

            return res.status(500).json({
                message: "Unable to retrieve bookings"
            });
        }
    }
);


// Cancel Booking
// PATCH /booking/:id/cancel
// User (Own Booking) / Admin

app.patch(
    "/booking/:id/cancel",
    authenticate,
    async (req, res) => {

        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                message: "Invalid booking ID"
            });
        }

        try {
            let cancelledBooking;

            await mongoose.connection.transaction(async (session) => {

                // Find booking
                const booking = await Booking.findById(
                    req.params.id
                ).session(session);

                if (!booking) {
                    const error = new Error("Booking not found");
                    error.httpStatus = 404;
                    throw error;
                }

                // Users can only cancel their own bookings
                if (
                    req.user.role !== "admin" &&
                    booking.customerId.toString() !== req.user.id
                ) {
                    const error = new Error("Unauthorized");
                    error.httpStatus = 403;
                    throw error;
                }

                // Prevent repeated cancellation
                if (booking.status === "CANCELLED") {
                    const error = new Error(
                        "Booking is already cancelled"
                    );
                    error.httpStatus = 400;
                    throw error;
                }

                // Cannot cancel if a rental record exists
                const rental = await mongoose.connection.db
                    .collection("rentals")
                    .findOne(
                        { bookingId: booking._id },
                        { session }
                    );

                if (rental) {
                    const error = new Error(
                        "Cannot cancel a booking with a rental record"
                    );
                    error.httpStatus = 409;
                    throw error;
                }

                // Update booking status
                booking.status = "CANCELLED";
                await booking.save({ session });

                // Release only this booking's date locks
                await mongoose.connection.db
                    .collection("booking_date_locks")
                    .deleteMany(
                        { bookingId: booking._id },
                        { session }
                    );

                cancelledBooking = booking;
            });

            return res.status(200).json({
                message: "Booking cancelled successfully",
                booking: cancelledBooking
            });

        } catch (error) {

            if (error.httpStatus) {
                return res.status(error.httpStatus).json({
                    message: error.message
                });
            }

            console.error("Cancellation failed:", error);

            return res.status(500).json({
                message: "Unable to cancel booking"
            });
        }
    }
);


// Handle Unknown Endpoints

app.use((req, res) => {
    return res.status(404).json({
        message: "Endpoint not found"
    });
});


// Start Booking Service

async function startServer() {
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing");
        }

        await connectDB();

        // Unique index prevents the same car from
        // being booked twice for the same day.
        await mongoose.connection.db
            .collection("booking_date_locks")
            .createIndex(
                { carId: 1, day: 1 },
                { unique: true }
            );

        app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `Booking Service running on port ${PORT}`
            );
        });

    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
}

startServer();
