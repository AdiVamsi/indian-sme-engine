FROM node:20-alpine

WORKDIR /app

# Install all deps (including dev — needed for prisma generate)
COPY package*.json ./
RUN npm ci

# Copy source and generate Prisma client
COPY . .
RUN npx prisma generate

# Prune dev dependencies for a leaner production image
RUN npm prune --omit=dev

EXPOSE 4000

CMD ["node", "src/server.js"]
