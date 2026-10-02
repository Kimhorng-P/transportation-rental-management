# Use the official Node.js 24 Alpine image
FROM node:24-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Document the port the application listens on
EXPOSE 5004

# Run the container as a non-root user for security
USER node

# Start the application
CMD ["npm", "start"]