# Database migrations

This repo uses `dbmate` for schema changes.

## Commands

```bash
# Create env files from the single template
cp .env.example .env.development
cp .env.example .env.staging
cp .env.example .env.production

# Create a new migration file
pnpm db:new add_feature_table

# Run migrations (explicit DATABASE_URL in shell)
DATABASE_URL=postgres://... pnpm db:up

# Environment-file wrappers
pnpm db:up:dev
pnpm db:up:staging
pnpm db:up:prod
```

## Migration location

All canonical migrations live in `db/migrations`.

## Notes

- dbmate tracks applied versions in `schema_migrations`.
- `DATABASE_URL` must be a Postgres connection string.
- `apps/functions/sql` is deprecated; keep new schema changes in `db/migrations`.
