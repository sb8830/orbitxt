# OrbiTxt Technologies — Setup Guide

## Project Structure

```
orbitxt/
├── server.js              ← Express backend + all API routes
├── db.js                  ← SQLite database setup + seed data
├── package.json           ← Dependencies
├── package-lock.json      ← Locked dependency versions
├── orbitxt.db             ← Auto-created on first run (do NOT commit)
└── public/
    ├── index.html         ← Main website (dynamic, pulls from API)
    └── admin.html         ← Admin panel (full CMS)
```

---

## Quick Start (3 steps)

### Step 1 — Install Node.js
Download Node.js v18+ from: https://nodejs.org  
Verify: `node --version`  (should show v18 or higher)

### Step 2 — Install dependencies
Open terminal **inside the orbitxt folder** and run:
```bash
npm install
```

### Step 3 — Start the server
```bash
node server.js
```

You should see:
```
✅ Database ready at /path/to/orbitxt.db
🚀 OrbiTxt Server running at http://localhost:3000
📊 Admin Panel: http://localhost:3000/admin.html
```

---

## ⚠️ Common Issue: "Server Unreachable" on Login

This error means the Node.js server is **not running**.

**Fix:**
1. Open a terminal / command prompt
2. Navigate to the orbitxt folder: `cd path/to/orbitxt`
3. Run: `node server.js`
4. Keep this terminal window **open** while using the app
5. Now visit http://localhost:3000 in your browser

> The server must be running for login and all API calls to work.  
> The HTML files alone (opened via file://) will NOT work.

---

## Access URLs

| URL | Description |
|-----|-------------|
| http://localhost:3000 | Main website |
| http://localhost:3000/admin.html | Admin panel |

---

## Default Login Credentials

### Admin Panel
- Email: `admin@orbitxt.com`
- Password: `Admin@123`

### Demo Client
- Email: `demo@acmecorp.com`
- Password: `Client@123`

---

## Admin Panel Features

| Section | What You Can Do |
|---------|----------------|
| **Section Visibility** | Toggle any website section on/off with a switch |
| **Site Content** | Edit hero text, about, CTA, footer — click any field to edit inline |
| **Hero Stats** | Edit the 4 stat numbers (uptime, cities, SMS/day, clients) |
| **Services** | Add/edit/delete service cards with bullet points |
| **Why Choose Us** | Add/edit/delete feature cards |
| **Industries** | Add/edit/delete industry chips |
| **Pricing Plans** | Add/edit/delete plans with feature tags |
| **Users** | Add/edit/delete clients; set panel URL, panel username, panel password, SMS credits |
| **Activity Log** | View all admin actions with timestamps |

---

## How Client Login Works

1. Client visits the website and clicks **Login**
2. Enters their email + password (set by admin)
3. Backend authenticates → returns JWT + `panel_url`
4. Browser redirects to their `panel_url` (e.g. https://panel.company.com)
5. Admins are redirected to `/admin.html`

To set a client's panel URL and credentials, go to:  
**Admin → Users → Edit User**

---

## API Endpoints

### Public
- `GET  /api/site` — All public content (plans, features, stats, text, section visibility)
- `POST /api/auth/login` — Login `{ email, password }`
- `GET  /api/auth/me` — Verify token

### Admin (requires Bearer token + admin role)
- `GET/POST /api/admin/users` — List / Create users
- `PUT/DELETE /api/admin/users/:id` — Update / Delete user
- `GET/POST /api/admin/plans` — List / Create plans
- `PUT/DELETE /api/admin/plans/:id` — Update / Delete plan
- `GET/POST /api/admin/services` — List / Create services
- `PUT/DELETE /api/admin/services/:id` — Edit / Delete service
- `GET/POST /api/admin/features` — List / Create features
- `PUT/DELETE /api/admin/features/:id` — Edit / Delete feature
- `GET/POST /api/admin/industries` — List / Create industries
- `PUT/DELETE /api/admin/industries/:id` — Edit / Delete industry
- `GET /api/admin/sections` — List all section visibility
- `PUT /api/admin/sections/:key` — Toggle section visibility
- `GET /api/admin/content` — All CMS content
- `PUT /api/admin/content` — Update content `{ section, key, value }`
- `GET /api/admin/stats` — Hero stats
- `PUT /api/admin/stats/:id` — Update stat
- `GET /api/admin/dashboard` — Dashboard overview
- `GET /api/admin/activity` — Activity log

---

## Development Mode (auto-restart on file save)
```bash
npm run dev
```

---

## Reset Database
Delete `orbitxt.db` and restart the server — it will recreate with fresh seed data:
```bash
rm orbitxt.db
node server.js
```

---

## Production Tips
1. Set a strong `JWT_SECRET` environment variable
2. Use `pm2` to keep running: `npm install -g pm2 && pm2 start server.js`
3. Put behind nginx/caddy with SSL
4. Back up `orbitxt.db` regularly — it contains all your data
