# ---- Build Stage ----
# Use a specific Node.js version. Alpine is used for a smaller image size.
FROM node:20-alpine AS base

# Set the working directory inside the container.
WORKDIR /app

# ---- Dependencies/Build Stage ----
# This stage installs all dependencies and builds the entire monorepo.
FROM base AS builder

# Copy root package files to leverage Docker cache.
COPY package.json package-lock.json ./

# Copy the rest of the monorepo source code.
COPY . .

# Install all dependencies and build the monorepo.
RUN npm install
RUN npm run build

# ---- Final Stage ----
# This stage creates the final, lean production image.
FROM base AS final

# It's a good practice to run as a non-root user for security.
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

# Set the final working directory.
WORKDIR /app

# We also copy the entire built monorepo's node_modules to handle workspace dependencies.
COPY --chown=nodejs:nodejs --from=builder /app/node_modules ./node_modules

# Copy the built bundle from the builder stage.
COPY --chown=nodejs:nodejs --from=builder /app/build ./build

# Expose the port your application listens on.
EXPOSE 3001

# Command to run the application.
# This runs the bundled javascript file with the --http flag.
CMD ["node", "build/index.js", "--http"]