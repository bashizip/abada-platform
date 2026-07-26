# Development Dockerfile
FROM node:24.18.0-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

RUN chmod +x /app/docker-entrypoint.sh

# Expose port 3002 for Vite development server
EXPOSE 5603

# Start the development server.
# Call Vite directly to avoid broken npm shim resolution in some environments.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "5603"]
