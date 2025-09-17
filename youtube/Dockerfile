# Use an official Node.js runtime as the base image
FROM node:20-slim

# Set working directory inside the container
WORKDIR /usr/src/app

# Install dependencies defined in package.json / package-lock.json
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application source code
COPY . .

# Document the port the server listens on (adjust if needed)
EXPOSE 3021

# Provide an interactive shell by default so the server can be started manually
CMD ["bash"]
