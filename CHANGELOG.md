# Changelog

All notable changes to worldshop-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2025-07-15

### Added — Service 1: Auth Middleware
- JWT authentication middleware (`requireAuth`, `optionalAuth`) with local token verification
- Admin authorization middleware (`requireAdmin`) for role-based access control
- Zod validation middleware (`validate`, `validateQuery`) for request body and query param validation
- Express Request type extension with `JwtPayload` (id, email, firstName, lastName, role)
- Cookie-parser support for reading HttpOnly JWT cookies from WorldStreet Identity
- JWT environment config: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`

### Added — Service 2: Profile
- `UserProfile` Prisma model with userId, email, firstName, lastName, phone, avatar, dateOfBirth, gender
- `Gender` enum (MALE, FEMALE, OTHER, PREFER_NOT_TO_SAY)
- Profile service with auto-create on first access (`getOrCreateProfile`)
- Profile update with Zod validation (`updateProfileSchema`)
- `GET /api/v1/profile` — fetch authenticated user's profile
- `PATCH /api/v1/profile` — update profile fields

### Changed
- CORS now configured for `shop.worldstreetgold.com` + localhost dev origins, with `credentials: true`
- CORS allows `X-Session-ID` header (for future guest cart)
- `envConfig.ts` exports `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `CLIENT_URL`

### Dependencies
- Added: `jsonwebtoken`, `@types/jsonwebtoken`, `zod`, `cookie-parser`, `@types/cookie-parser`

## [0.1.0] - Initial

### Added
- Express 5 server with TypeScript
- Prisma with MongoDB connection
- Rate limiting, Sentry error tracking, Winston logging
- Task CRUD sample routes
- Health check endpoint
