# Database Scripts

Prisma is configured in `apps/api/prisma/schema.prisma`.

Root scripts:

```bash
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
npm run db:reset
```

`db:reset` is for local development only because it drops and recreates database state.

Required environment:

- `DATABASE_URL`
- `DEV_ADMIN_EMAIL`
- `DEV_ADMIN_PASSWORD_HASH`

The seed is idempotent for pipeline stages and the development admin user.

The default local Docker URL is:

```text
postgresql://shilabs:shilabs_dev_password@localhost:5433/shilabs_sales
```
