const jwt = require("jsonwebtoken");

// Verify JWT token
function authToken(req, res, next) {
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
            !["admin", "user"].includes(decoded.role)
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

// Check user role
function authRole(role) {
    return (req, res, next) => {
        if (req.user.role !== role) {
            return res.status(403).json({
                message: "Unauthorized"
            });
        }

        next();
    };
}

module.exports = { authToken, authRole };
