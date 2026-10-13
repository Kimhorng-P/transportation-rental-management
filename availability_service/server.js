const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { connectDB, Car } = require("./db");

require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5004;

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
            typeof decoded !== "object"
        ) {
            return res.status(401).json({
                message: "Invalid token"
            });
        }

        if (!["user", "admin"].includes(decoded.role)) {
            return res.status(403).json({
                message: "Only User and Admin can access availability"
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


function validateDateRange(startDate, endDate) {
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    if (!start || !end) {
        return {
            error: "Valid startDate and endDate in YYYY-MM-DD are required"
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

    return { start, end };

}


// Check Booking and Rental Conflicts

async function checkCarAvailability(car, start, end) {

    // Check car operational status
    if (car.status !== "ACTIVE") {
        return {
            available: false,
            reason: "Car is under maintenance or archived"
        };
    }

    // Check overlapping confirmed bookings
    const overlappingBooking = await mongoose.connection.db
        .collection("bookings")
        .findOne({
            carId: car._id,
            status: "CONFIRMED",
            startDate: { $lt: end },
            endDate: { $gt: start }
        });

    if (overlappingBooking) {
        return {
            available: false,
            reason: "Car is already booked for these dates"
        };
    }

    // Check active rentals that have not been returned
    const activeRentals = await mongoose.connection.db
    .collection("rentals")
    .find({
        carId: car._id,
        status: "ACTIVE",
        actualReturnDate: null
    })
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
        return {
            available: false,
            reason: "Car is rented, overdue, or has incomplete rental dates"
        };
    }
  }
    return {
    available: true,
    reason: "Car is available for these dates"
  };
}

// Search Available Cars
// GET /availability

app.get("/availability", authenticate, async (req, res) => {
    try {
        const { carName, startDate, endDate } = req.query;

        const hasStart = startDate !== undefined;
        const hasEnd = endDate !== undefined;

        // Both dates must be supplied together
        if (hasStart !== hasEnd) {
            return res.status(400).json({
                message: "Both startDate and endDate are required"
            });
        }

        let start;
        let end;

        if (hasStart && hasEnd) {
            const validation = validateDateRange(
                startDate,
                endDate
            );

            if (validation.error) {
                return res.status(400).json({
                    message: validation.error
                });
            }

            start = validation.start;
            end = validation.end;
        }

        // Only search operational cars
        const filter = {
            status: "ACTIVE"
        };

        // Optional car name search
        if (carName !== undefined) {
            if (
                typeof carName !== "string" ||
                !carName.trim() ||
                carName.length > 100
            ) {
                return res.status(400).json({
                    message: "Invalid carName"
                });
            }

            // Support "Toyota", "Prius", or "Toyota Prius"
            const words = carName.trim().split(/\s+/);

            filter.$and = words.map(word => {
                const escaped = word.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    "\\$&"
                );

                return {
                    $or: [
                        {
                            brand: {
                                $regex: escaped,
                                $options: "i"
                            }
                        },
                        {
                            model: {
                                $regex: escaped,
                                $options: "i"
                            }
                        }
                    ]
                };
            });
        }

        // Retrieve matching active cars
        const cars = await Car.find(filter).lean();

        // No dates: return operational cars only
        if (!hasStart) {
            return res.status(200).json({
                message: "Active cars retrieved successfully",
                dateAvailabilityChecked: false,
                count: cars.length,
                cars
            });
        }

        // Dates supplied: check each car
        const results = await Promise.all(
            cars.map(async (car) => {
                const result = await checkCarAvailability(
                    car,
                    start,
                    end
                );

                return {
                    ...car,
                    available: result.available
                };
            })
        );

        // Return only cars available for selected dates
        const availableCars = results.filter(
            car => car.available
        );

        return res.status(200).json({
            message: "Available cars retrieved successfully",
            startDate,
            endDate,
            dateAvailabilityChecked: true,
            count: availableCars.length,
            cars: availableCars
        });

    } catch (error) {
        console.error("Availability search failed:", error);

        return res.status(500).json({
            message: "Unable to search available cars"
        });
    }
});


// Check Specific Car Availability
// GET /availability/check

app.get("/availability/check", authenticate, async (req, res) => {
    try {
        const { carId, startDate, endDate } = req.query;

        // Validate car ID
        if (
            typeof carId !== "string" ||
            !mongoose.isValidObjectId(carId)
        ) {
            return res.status(400).json({
                message: "A valid carId is required"
            });
        }

        // Validate dates
        const validation = validateDateRange(
            startDate,
            endDate
        );

        if (validation.error) {
            return res.status(400).json({
                message: validation.error
            });
        }

        const { start, end } = validation;

        // Find requested car
        const car = await Car.findById(carId).lean();

        if (!car) {
            return res.status(404).json({
                message: "Car not found"
            });
        }

        // Check availability
        const result = await checkCarAvailability(
            car,
            start,
            end
        );

        return res.status(200).json({
            carId: car._id,
            carName: `${car.brand} ${car.model}`,
            startDate,
            endDate,
            available: result.available,
            reason: result.reason
        });

    } catch (error) {
        console.error("Availability check failed:", error);

        return res.status(500).json({
            message: "Unable to check availability"
        });
    }
});


// Handle Unknown Endpoints

app.use((req, res) => {
    return res.status(404).json({
        message: "Endpoint not found"
    });
});


//  Start Availability Service

async function startServer() {
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing");
        }

        await connectDB();

        app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `Availability Service running on port ${PORT}`
            );
        });

    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
}

startServer();