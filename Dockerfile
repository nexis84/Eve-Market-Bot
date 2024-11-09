# Use Node.js image as base
FROM node:16

# Set working directory in container
WORKDIR /app

# Copy package.json and package-lock.json (if exists)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all files into the container
COPY . .

# Expose port for Cloud Run
EXPOSE 8080

# Run the app using node
CMD ["node", "index.js"]
