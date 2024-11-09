# Use official Node.js image
FROM node:16

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app code
COPY . .

# Expose port for Cloud Run
EXPOSE 8080

# Command to start the app
CMD ["node", "index.js"]
