# basicdiet145 Backend

Node.js Express backend API for the Basic Diet meal planning system.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env  # if exists, or create manually

# Start the server
npm start

# Run tests
npm run test
npm run test:integration
```

## Requirements

- Node.js 20+
- MongoDB

## Environment Variables

Required environment variables:
- `PORT` - Server port (default: 3000)
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret
- `CLOUDINARY_*` - Cloudinary configuration (for image uploads)

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run test` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run seed` | Seed demo data |
| `npm run seed:builder` | Seed meal builder catalog |
| `npm run seed:dashboard-users` | Seed dashboard users |
| `npm run diagnose:mongo` | Diagnose MongoDB connection |

## API Documentation

- [API Integration Guide](API_INTEGRATION_GUIDE.md) - Arabic API reference
- [Meal Planner Integration](MEAL_PLANNER_INTEGRATION.md) - Meal planner API guide
- [Test Coverage](docs/MEAL_PLANNER_TEST_COVERAGE.md) - Test documentation

## Project Structure

```
src/
├── index.js        # Entry point
├── app.js          # Express app setup
├── db.js           # Database connection
├── config/         # Configuration
├── constants/      # Constants
├── controllers/   # Route handlers
├── middleware/     # Express middleware
├── models/         # Mongoose models
├── routes/         # API routes
├── services/      # Business logic
├── jobs/           # Background jobs
├── utils/          # Utilities
└── types/          # Type definitions
```

## Tech Stack

- Express.js - Web framework
- MongoDB/Mongoose - Database
- JWT - Authentication
- Cloudinary - Image uploads
- Winston - Logging