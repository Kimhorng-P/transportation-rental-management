const express = require("express");
const bcrypt = require("bcrypt");
const { connectDB, User } = require("./db");

require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5001;

// Register User
// POST /register

app.post("/register", async (req, res) => {
    try {
        const { name, email, password, phone, role = "user" } = req.body || {};

        // Validate required fields
        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            typeof phone !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !password ||
            !phone.trim()
        ) {
            return res.status(400).json({
                message: "Name, email, password and phone are required"
            });
        }

        // Validate role
        if (!["user", "admin"].includes(role)) {
            return res.status(400).json({
            message: "Role must be either user or admin"
            });
        }

        // Normalize email
        const normalizedEmail = email.trim().toLowerCase();

        // Check whether email already exists
        const existingUser = await User.findOne({
            email: normalizedEmail
        });

        if (existingUser) {
            return res.status(409).json({
                message: "Email already exists"
            });
        }

        // Hash password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user with selected role
        const newUser = await User.create({
            name: name.trim(),
            email: normalizedEmail,
            password: hashedPassword,
            phone: phone.trim(),
            role
        });

        return res.status(201).json({
            message: "User registered successfully",
            user: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                phone: newUser.phone,
                role: newUser.role
            }
        });

    } catch (error) {

        // Handle duplicate email from MongoDB unique index
        if (error.code === 11000) {
            return res.status(409).json({
                message: "Email already exists"
            });
        }

        console.error("Registration failed:", error);

        return res.status(500).json({
            message: "Unable to register user"
        });
    }
});


// Handle Unknown Endpoints

app.use((req, res) => {
    return res.status(404).json({
        message: "Endpoint not found"
    });
});


// Start Registration Service

async function startServer() {
    try {
        await connectDB();

        app.listen(PORT, "0.0.0.0", () => {
            console.log(
                `Registration Service running on port ${PORT}`
            );
        });

    } catch (error) {
        console.error("Startup failed:", error.message);
        process.exit(1);
    }
}

startServer()