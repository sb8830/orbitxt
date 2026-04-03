# Supabase setup for OrbitXT

## 1) Create the project
- Create a new Supabase project.
- Copy the **Session pooler** connection string from **Connect**.
- Put it into `DATABASE_URL`.

Example:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

## 2) Run the schema
In Supabase SQL Editor, run `init.sql`.

## 3) Environment variables
Set these in Render:
- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV=production`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- optional demo values from `.env.example`

## 4) Table structure
### Core app tables
- `users`: admins and client accounts
- `plans`: pricing plans
- `content`: editable site copy
- `sections`: section visibility flags
- `stats`: hero counters
- `features`: why choose us items
- `services`: services cards
- `industries`: industries cards
- `leads`: public form submissions

### Logging tables
- `activity_log`: admin actions shown in the admin panel
- `app_logs`: backend/server logs such as startup, auth failures, lead submissions, and errors

## 5) Recommended policies
Because this app connects with the server using Postgres directly, keep all writes behind the Node server.
- Do not expose the database password to the browser.
- Do not use the service role key in frontend code.
- If you later add Supabase client-side access, enable RLS and create read-only policies only where needed.

## 6) Useful queries
### Latest server logs
```sql
select * from app_logs order by created_at desc limit 100;
```

### Latest admin actions
```sql
select * from activity_log order by created_at desc limit 100;
```

### New leads
```sql
select * from leads where status = 'new' order by created_at desc;
```

## 7) How logging works now
- `activity_log` stores create/update/delete actions from the admin panel.
- `app_logs` stores backend events like server startup, login failures, successful logins, lead creation, and unhandled errors.

If you want deeper observability later, the next upgrade is adding request logging middleware that inserts summarized request records into `app_logs`.
