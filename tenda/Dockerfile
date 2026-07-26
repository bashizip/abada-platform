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

# Expose port 5602 for Vite development server
EXPOSE 5602

# Start the development server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5602"]
