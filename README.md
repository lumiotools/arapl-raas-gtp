# WMS GTP

This project is a **NestJS** backend service that connects to a **PostgreSQL** database.

---

## Environment Variables

These environment variables are required by the application:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=wms_gtp
DB_SSL=true
```

You can either:

- Add them directly to the `docker-compose.yml`, or
- Create a `.env` file and reference it in the compose file (recommended for security and reusability).

---

## Running the Application

### Option 1: Run with Docker Compose

> Runs the app in a container using the included Dockerfile.

#### `docker-compose.yml`

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - '8000:8000'
    environment:
      - DB_HOST=localhost
      - DB_PORT=5432
      - DB_USERNAME=postgres
      - DB_PASSWORD=postgres
      - DB_DATABASE=wms_gtp
      - DB_SSL=true
```

#### Run the container

```bash
docker-compose up --build
```

---

### Option 2: Run in Development Mode (without Docker)

> Uses hot-reloading for faster iteration.

1. Install dependencies:

```bash
npm install
```

2. Start the app in development mode:

```bash
npm run start-dev
```

Make sure your `.env` file is correctly configured in the root directory.

---

### Option 3: Build and Run Manually (Production-like without Docker)

1. Build the project:

```bash
npm run build
```

2. Start the application:

```bash
npm run start
```
