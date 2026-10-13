const express = require("express");
const httpProxy = require("http-proxy");
const { authToken } = require("./auth");

require("dotenv").config();

const app = express();
const proxy = httpProxy.createProxyServer();

const PORT = process.env.PORT || 3000;

// Docker Compose service addresses
const REGISTRATION_SERVICE =
    process.env.REGISTRATION_SERVICE_URL ||
    "http://registration_service:5001";

const LOGIN_SERVICE =
    process.env.LOGIN_SERVICE_URL ||
    "http://login_service:5002";

const AVAILABILITY_SERVICE =
    process.env.AVAILABILITY_SERVICE_URL ||
    "http://availability_service:5004";

const BOOKING_SERVICE =
    process.env.BOOKING_SERVICE_URL ||
    "http://booking_service:5005";


// Handle proxy connection errors
proxy.on("error", (error, req, res) => {
    console.error("Proxy error:", error.message);

    if (!res.headersSent) {
        res.status(502).json({
            message: "Microservice unavailable"
        });
    } else {
        res.end();
    }
});

// Registration Service
// POST /register

app.use("/register", (req, res) => {
    req.url = "/register" + req.url;

    proxy.web(req, res, {
        target: REGISTRATION_SERVICE
    });
});

// Login Service
// POST /login

app.use("/login", (req, res) => {
    req.url = "/login" + req.url;

    proxy.web(req, res, {
        target: LOGIN_SERVICE
    });
});

// Availability Service
// GET /availability
// GET /availability/check

app.use("/availability", authToken, (req, res) => {
    req.url = "/availability" + req.url;

    proxy.web(req, res, {
        target: AVAILABILITY_SERVICE
    });
});

// Booking Service
// POST /booking
// GET /booking
// GET /booking/my
// PATCH /booking/:id/cancel

app.use("/booking", authToken, (req, res) => {
    req.url = "/booking" + req.url;

    proxy.web(req, res, {
        target: BOOKING_SERVICE
    });
});

// Unknown Endpointc
app.use((req, res) => {
    return res.status(404).json({
        message: "Endpoint not found"
    });
});

// Start API Gatewac

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `API Gateway running on port ${PORT}`
    );
});
