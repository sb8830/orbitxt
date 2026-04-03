require('dotenv').config();

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { Country, State, City } = require('country-state-city');
const { initDB, query, one, many, logActivity, logApp } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '8h';
const LEGACY_LOGIN_USERNAME = process.env.LEGACY_LOGIN_USERNAME || 'admin';
const LEGACY_LOGIN_PASSWORD = process.env.LEGACY_LOGIN_PASSWORD || '1234';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required. Add it in your environment variables.');
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function asBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeUser(row) {
  if (!row) return row;
  return {
    ...row,
    id: Number(row.id),
    auto_login: !!row.auto_login,
    active: row.active === undefined ? row.active : !!row.active,
    credits: Number(row.credits || 0)
  };
}

function normalizePlan(row) {
  return {
    ...row,
    id: Number(row.id),
    price: Number(row.price || 0),
    sms_count: Number(row.sms_count || 0),
    panels: Number(row.panels || 0),
    sort_order: Number(row.sort_order || 0),
    popular: !!row.popular,
    active: !!row.active,
    features: parseJsonArray(row.features)
  };
}

function normalizeService(row) {
  return {
    ...row,
    id: Number(row.id),
    active: !!row.active,
    sort_order: Number(row.sort_order || 0),
    bullet_points: parseJsonArray(row.bullet_points)
  };
}

function normalizeFeature(row) {
  return {
    ...row,
    id: Number(row.id),
    featured: !!row.featured,
    active: !!row.active,
    sort_order: Number(row.sort_order || 0)
  };
}

function normalizeIndustry(row) {
  return {
    ...row,
    id: Number(row.id),
    active: !!row.active,
    sort_order: Number(row.sort_order || 0)
  };
}

function normalizeSection(row) {
  return {
    ...row,
    id: Number(row.id),
    visible: !!row.visible,
    sort_order: Number(row.sort_order || 0)
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      company: user.company_name
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) {
    logApp('warn', 'auth_invalid_token', 'Token invalid or expired', { path: req.path }).catch(() => {});
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/health', asyncHandler(async (req, res) => {
  const dbTime = await one('SELECT NOW() AS now');
  res.json({ ok: true, dbTime: dbTime.now });
}));

// PUBLIC API
app.get('/api/site', asyncHandler(async (req, res) => {
  const [contentRows, planRows, statsRows, featureRows, serviceRows, industryRows, sectionRows] = await Promise.all([
    many('SELECT section, key, value FROM content ORDER BY section, key'),
    many('SELECT * FROM plans WHERE active = TRUE ORDER BY sort_order, id'),
    many('SELECT * FROM stats ORDER BY sort_order, id'),
    many('SELECT * FROM features WHERE active = TRUE ORDER BY sort_order, id'),
    many('SELECT * FROM services WHERE active = TRUE ORDER BY sort_order, id'),
    many('SELECT * FROM industries WHERE active = TRUE ORDER BY sort_order, id'),
    many('SELECT section_key, visible FROM sections ORDER BY sort_order, id')
  ]);

  const contentMap = {};
  for (const { section, key, value } of contentRows) {
    if (!contentMap[section]) contentMap[section] = {};
    contentMap[section][key] = value;
  }

  const sectionVisibility = {};
  for (const row of sectionRows) {
    sectionVisibility[row.section_key] = !!row.visible;
  }

  res.json({
    content: contentMap,
    plans: planRows.map(normalizePlan),
    stats: statsRows.map((row) => ({ ...row, sort_order: Number(row.sort_order || 0) })),
    features: featureRows.map(normalizeFeature),
    services: serviceRows.map(normalizeService),
    industries: industryRows.map(normalizeIndustry),
    sections: sectionVisibility
  });
}));

// LOGIN
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const identifier = (req.body.email || req.body.username || '').trim();
  const { password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  let loginEmail = identifier.toLowerCase();
  const adminAlias = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@orbitxt.com').toLowerCase();
  if (!loginEmail.includes('@') && loginEmail === adminAlias) {
    loginEmail = adminEmail;
  }

  const user = await one(
    'SELECT * FROM users WHERE email = $1 AND active = TRUE LIMIT 1',
    [loginEmail]
  );

  if (!user) {
    await logApp('warn', 'login_failed', 'User not found or inactive', { email: loginEmail });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    await logApp('warn', 'login_failed', 'Invalid password', { email: user.email });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const normalized = normalizeUser(user);
  const token = signToken(normalized);
  await logApp('info', 'login_success', 'User logged in', { email: normalized.email, role: normalized.role });

  res.json({
    token,
    user: {
      id: normalized.id,
      email: normalized.email,
      company_name: normalized.company_name,
      role: normalized.role,
      panel_url: normalized.panel_url,
      panel_username: normalized.panel_username,
      panel_password: normalized.panel_password,
      auto_login: normalized.auto_login,
      credits: normalized.credits
    }
  });
}));

app.get('/api/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await one(
    `SELECT id, email, company_name, role, panel_url, panel_username, panel_password, auto_login, credits
     FROM users WHERE id = $1`,
    [req.user.id]
  );
  res.json({ user: normalizeUser(user) });
}));

// ADMIN API
app.get('/api/admin/dashboard', requireAdmin, asyncHandler(async (req, res) => {
  const [totalUsers, activeUsers, totalPlans, recentActivity, recentUsers, leadCount] = await Promise.all([
    one(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'client'`),
    one(`SELECT COUNT(*)::int AS c FROM users WHERE role = 'client' AND active = TRUE`),
    one('SELECT COUNT(*)::int AS c FROM plans WHERE active = TRUE'),
    many('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10'),
    many(`SELECT id, email, company_name, created_at FROM users WHERE role = 'client' ORDER BY created_at DESC LIMIT 5`),
    one(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'new'`)
  ]);

  res.json({
    totalUsers: totalUsers.c,
    activeUsers: activeUsers.c,
    totalPlans: totalPlans.c,
    recentActivity,
    recentUsers,
    newLeads: leadCount.c
  });
}));

// USERS CRUD
app.get('/api/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const users = await many(`
    SELECT id, email, company_name, role, panel_url, panel_username, panel_password,
           auto_login, credits, active, created_at
    FROM users
    ORDER BY created_at DESC
  `);
  res.json({ users: users.map(normalizeUser) });
}));

app.post('/api/admin/users', requireAdmin, asyncHandler(async (req, res) => {
  const { email, password, company_name, role, panel_url, panel_username, panel_password, auto_login, credits } = req.body;
  if (!email || !password || !company_name) {
    return res.status(400).json({ error: 'email, password, company_name required' });
  }

  const existing = await one('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (existing) {
    return res.status(409).json({ error: 'Email already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await query(
    `INSERT INTO users (
      email, password_hash, company_name, role, panel_url, panel_username, panel_password, auto_login, credits
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      email.toLowerCase().trim(),
      hash,
      company_name,
      role || 'client',
      panel_url || null,
      panel_username || null,
      panel_password || null,
      asBool(auto_login),
      Number(credits || 0)
    ]
  );

  await logActivity(req.user.email, 'CREATE_USER', email.toLowerCase().trim());
  res.json({ id: result.rows[0].id, message: 'User created' });
}));

app.put('/api/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { email, company_name, role, panel_url, panel_username, panel_password, auto_login, credits, active, password } = req.body;
  const user = await one('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const hash = password ? bcrypt.hashSync(password, 10) : user.password_hash;

  await query(
    `UPDATE users
     SET email = $1,
         password_hash = $2,
         company_name = $3,
         role = $4,
         panel_url = $5,
         panel_username = $6,
         panel_password = $7,
         auto_login = $8,
         credits = $9,
         active = $10
     WHERE id = $11`,
    [
      (email || user.email).toLowerCase(),
      hash,
      company_name || user.company_name,
      role || user.role,
      panel_url !== undefined ? panel_url : user.panel_url,
      panel_username !== undefined ? panel_username : user.panel_username,
      panel_password !== undefined ? panel_password : user.panel_password,
      auto_login !== undefined ? asBool(auto_login) : !!user.auto_login,
      credits !== undefined ? Number(credits) : Number(user.credits || 0),
      active !== undefined ? asBool(active) : !!user.active,
      req.params.id
    ]
  );

  await logActivity(req.user.email, 'UPDATE_USER', `id:${req.params.id}`);
  res.json({ message: 'User updated' });
}));

app.delete('/api/admin/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const user = await one('SELECT email FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.email === req.user.email) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  await query('DELETE FROM users WHERE id = $1', [req.params.id]);
  await logActivity(req.user.email, 'DELETE_USER', user.email);
  res.json({ message: 'User deleted' });
}));

// PLANS CRUD
app.get('/api/admin/plans', requireAdmin, asyncHandler(async (req, res) => {
  const plans = await many('SELECT * FROM plans ORDER BY sort_order, id');
  res.json({ plans: plans.map(normalizePlan) });
}));

app.post('/api/admin/plans', requireAdmin, asyncHandler(async (req, res) => {
  const { name, price, sms_count, panels, popular, features, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const result = await query(
    `INSERT INTO plans (name, price, sms_count, panels, popular, features, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      name,
      Number(price || 0),
      Number(sms_count || 0),
      Number(panels || 1),
      asBool(popular),
      JSON.stringify(parseJsonArray(features)),
      Number(sort_order || 99)
    ]
  );

  await logActivity(req.user.email, 'CREATE_PLAN', name);
  res.json({ id: result.rows[0].id, message: 'Plan created' });
}));

app.put('/api/admin/plans/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { name, price, sms_count, panels, popular, active, features, sort_order } = req.body;
  const plan = await one('SELECT * FROM plans WHERE id = $1', [req.params.id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  await query(
    `UPDATE plans
     SET name = $1,
         price = $2,
         sms_count = $3,
         panels = $4,
         popular = $5,
         active = $6,
         features = $7,
         sort_order = $8
     WHERE id = $9`,
    [
      name ?? plan.name,
      price ?? plan.price,
      sms_count ?? plan.sms_count,
      panels ?? plan.panels,
      popular !== undefined ? asBool(popular) : !!plan.popular,
      active !== undefined ? asBool(active) : !!plan.active,
      JSON.stringify(features !== undefined ? parseJsonArray(features) : parseJsonArray(plan.features)),
      sort_order ?? plan.sort_order,
      req.params.id
    ]
  );

  await logActivity(req.user.email, 'UPDATE_PLAN', req.params.id);
  res.json({ message: 'Plan updated' });
}));

app.delete('/api/admin/plans/:id', requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM plans WHERE id = $1', [req.params.id]);
  await logActivity(req.user.email, 'DELETE_PLAN', req.params.id);
  res.json({ message: 'Plan deleted' });
}));

// CONTENT CRUD
app.get('/api/admin/content', requireAdmin, asyncHandler(async (req, res) => {
  const content = await many('SELECT * FROM content ORDER BY section, key');
  res.json({ content });
}));

app.put('/api/admin/content', requireAdmin, asyncHandler(async (req, res) => {
  const { section, key, value } = req.body;
  if (!section || !key || value === undefined) {
    return res.status(400).json({ error: 'section, key, value required' });
  }

  await query(
    `INSERT INTO content (section, key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (section, key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [section, key, value]
  );

  await logActivity(req.user.email, 'UPDATE_CONTENT', `${section}.${key}`);
  res.json({ message: 'Content updated' });
}));

// SECTIONS VISIBILITY
app.get('/api/admin/sections', requireAdmin, asyncHandler(async (req, res) => {
  const sections = await many('SELECT * FROM sections ORDER BY sort_order, id');
  res.json({ sections: sections.map(normalizeSection) });
}));

app.put('/api/admin/sections/:key', requireAdmin, asyncHandler(async (req, res) => {
  const { visible } = req.body;
  await query('UPDATE sections SET visible = $1 WHERE section_key = $2', [asBool(visible), req.params.key]);
  await logActivity(req.user.email, 'TOGGLE_SECTION', `${req.params.key}:${asBool(visible) ? 'shown' : 'hidden'}`);
  res.json({ message: 'Section updated' });
}));

// FEATURES CRUD
app.get('/api/admin/features', requireAdmin, asyncHandler(async (req, res) => {
  const features = await many('SELECT * FROM features ORDER BY sort_order, id');
  res.json({ features: features.map(normalizeFeature) });
}));

app.post('/api/admin/features', requireAdmin, asyncHandler(async (req, res) => {
  const { icon, title, description, featured, sort_order } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const result = await query(
    `INSERT INTO features (icon, title, description, featured, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [icon || '📦', title, description || '', asBool(featured), Number(sort_order || 99)]
  );

  await logActivity(req.user.email, 'CREATE_FEATURE', title);
  res.json({ id: result.rows[0].id, message: 'Feature created' });
}));

app.put('/api/admin/features/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { icon, title, description, featured, active, sort_order } = req.body;
  const feature = await one('SELECT * FROM features WHERE id = $1', [req.params.id]);
  if (!feature) return res.status(404).json({ error: 'Feature not found' });

  await query(
    `UPDATE features
     SET icon = $1,
         title = $2,
         description = $3,
         featured = $4,
         active = $5,
         sort_order = $6
     WHERE id = $7`,
    [
      icon ?? feature.icon,
      title ?? feature.title,
      description ?? feature.description,
      featured !== undefined ? asBool(featured) : !!feature.featured,
      active !== undefined ? asBool(active) : !!feature.active,
      sort_order ?? feature.sort_order,
      req.params.id
    ]
  );

  await logActivity(req.user.email, 'UPDATE_FEATURE', req.params.id);
  res.json({ message: 'Feature updated' });
}));

app.delete('/api/admin/features/:id', requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM features WHERE id = $1', [req.params.id]);
  await logActivity(req.user.email, 'DELETE_FEATURE', req.params.id);
  res.json({ message: 'Feature deleted' });
}));

// SERVICES CRUD
app.get('/api/admin/services', requireAdmin, asyncHandler(async (req, res) => {
  const services = await many('SELECT * FROM services ORDER BY sort_order, id');
  res.json({ services: services.map(normalizeService) });
}));

app.post('/api/admin/services', requireAdmin, asyncHandler(async (req, res) => {
  const { icon, title, description, bullet_points, sort_order } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const result = await query(
    `INSERT INTO services (icon, title, description, bullet_points, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [icon || '📦', title, description || '', JSON.stringify(parseJsonArray(bullet_points)), Number(sort_order || 99)]
  );

  await logActivity(req.user.email, 'CREATE_SERVICE', title);
  res.json({ id: result.rows[0].id, message: 'Service created' });
}));

app.put('/api/admin/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { icon, title, description, bullet_points, active, sort_order } = req.body;
  const service = await one('SELECT * FROM services WHERE id = $1', [req.params.id]);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  await query(
    `UPDATE services
     SET icon = $1,
         title = $2,
         description = $3,
         bullet_points = $4,
         active = $5,
         sort_order = $6
     WHERE id = $7`,
    [
      icon ?? service.icon,
      title ?? service.title,
      description ?? service.description,
      JSON.stringify(bullet_points !== undefined ? parseJsonArray(bullet_points) : parseJsonArray(service.bullet_points)),
      active !== undefined ? asBool(active) : !!service.active,
      sort_order ?? service.sort_order,
      req.params.id
    ]
  );

  await logActivity(req.user.email, 'UPDATE_SERVICE', req.params.id);
  res.json({ message: 'Service updated' });
}));

app.delete('/api/admin/services/:id', requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM services WHERE id = $1', [req.params.id]);
  await logActivity(req.user.email, 'DELETE_SERVICE', req.params.id);
  res.json({ message: 'Service deleted' });
}));

// INDUSTRIES CRUD
app.get('/api/admin/industries', requireAdmin, asyncHandler(async (req, res) => {
  const industries = await many('SELECT * FROM industries ORDER BY sort_order, id');
  res.json({ industries: industries.map(normalizeIndustry) });
}));

app.post('/api/admin/industries', requireAdmin, asyncHandler(async (req, res) => {
  const { icon, name, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const result = await query(
    'INSERT INTO industries (icon, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
    [icon || '🏢', name, Number(sort_order || 99)]
  );

  await logActivity(req.user.email, 'CREATE_INDUSTRY', name);
  res.json({ id: result.rows[0].id, message: 'Industry created' });
}));

app.put('/api/admin/industries/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { icon, name, active, sort_order } = req.body;
  const industry = await one('SELECT * FROM industries WHERE id = $1', [req.params.id]);
  if (!industry) return res.status(404).json({ error: 'Industry not found' });

  await query(
    `UPDATE industries
     SET icon = $1,
         name = $2,
         active = $3,
         sort_order = $4
     WHERE id = $5`,
    [
      icon ?? industry.icon,
      name ?? industry.name,
      active !== undefined ? asBool(active) : !!industry.active,
      sort_order ?? industry.sort_order,
      req.params.id
    ]
  );

  await logActivity(req.user.email, 'UPDATE_INDUSTRY', req.params.id);
  res.json({ message: 'Industry updated' });
}));

app.delete('/api/admin/industries/:id', requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM industries WHERE id = $1', [req.params.id]);
  await logActivity(req.user.email, 'DELETE_INDUSTRY', req.params.id);
  res.json({ message: 'Industry deleted' });
}));

// STATS CRUD
app.get('/api/admin/stats', requireAdmin, asyncHandler(async (req, res) => {
  const stats = await many('SELECT * FROM stats ORDER BY sort_order, id');
  res.json({ stats });
}));

app.put('/api/admin/stats/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { label, value } = req.body;
  await query('UPDATE stats SET label = $1, value = $2 WHERE id = $3', [label, value, req.params.id]);
  await logActivity(req.user.email, 'UPDATE_STAT', req.params.id);
  res.json({ message: 'Stat updated' });
}));

// ACTIVITY LOG
app.get('/api/admin/activity', requireAdmin, asyncHandler(async (req, res) => {
  const logs = await many('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 50');
  res.json({ logs });
}));

app.get('/api/admin/system-logs', requireAdmin, asyncHandler(async (req, res) => {
  const logs = await many('SELECT * FROM app_logs ORDER BY created_at DESC LIMIT 200');
  res.json({ logs });
}));

// LEADS — public submit
app.post('/api/leads', asyncHandler(async (req, res) => {
  const { name, email, phone, country_code, company, country, state, city, message, source } = req.body;

  if (!name || !email || !phone || !country_code || !company || !country || !state || !city || !message) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const result = await query(
    `INSERT INTO leads
     (name, company, email, phone, country_code, country, state, city, message, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      name.trim(),
      company.trim(),
      email.trim().toLowerCase(),
      phone.trim(),
      country_code.trim(),
      country.trim(),
      state.trim(),
      city.trim(),
      message.trim(),
      source || 'Demo Request'
    ]
  );

  await logApp('info', 'lead_created', 'Lead submitted successfully', {
    id: result.rows[0].id,
    email: email.trim().toLowerCase(),
    company: company.trim()
  });

  res.json({
    success: true,
    id: result.rows[0].id,
    message: 'Lead submitted successfully'
  });
}));

// LEADS — admin list with filters
app.get('/api/admin/leads', requireAdmin, asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (search) {
    const likeValue = `%${search}%`;
    params.push(likeValue, likeValue, likeValue, likeValue);
    const start = params.length - 3;
    conditions.push(`(name ILIKE $${start} OR email ILIKE $${start + 1} OR company ILIKE $${start + 2} OR phone ILIKE $${start + 3})`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const leads = await many(`SELECT * FROM leads ${whereClause} ORDER BY created_at DESC`, params);
  const [allCount, newCount, contactedCount, qualifiedCount, convertedCount, lostCount] = await Promise.all([
    one('SELECT COUNT(*)::int AS c FROM leads'),
    one(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'new'`),
    one(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'contacted'`),
    one(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'qualified'`),
    one(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'converted'`),
    one(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'lost'`)
  ]);

  res.json({
    leads,
    counts: {
      all: allCount.c,
      new: newCount.c,
      contacted: contactedCount.c,
      qualified: qualifiedCount.c,
      converted: convertedCount.c,
      lost: lostCount.c
    }
  });
}));

// LEADS — update status & notes
app.put('/api/admin/leads/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  const lead = await one('SELECT * FROM leads WHERE id = $1', [req.params.id]);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const allowedStatuses = ['new', 'contacted', 'qualified', 'converted', 'lost'];
  const nextStatus = status !== undefined ? status : lead.status;
  if (!allowedStatuses.includes(nextStatus)) {
    return res.status(400).json({ error: 'Invalid lead status' });
  }

  await query(
    `UPDATE leads
     SET status = $1,
         notes = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [nextStatus, notes !== undefined ? notes : lead.notes, req.params.id]
  );

  await logActivity(req.user.email, 'UPDATE_LEAD', `id:${req.params.id}, status:${nextStatus}`);
  res.json({ message: 'Lead updated successfully' });
}));

// LEADS — delete
app.delete('/api/admin/leads/:id', requireAdmin, asyncHandler(async (req, res) => {
  const lead = await one('SELECT * FROM leads WHERE id = $1', [req.params.id]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await query('DELETE FROM leads WHERE id = $1', [req.params.id]);
  await logActivity(req.user.email, 'DELETE_LEAD', `${lead.name} (${lead.email})`);
  res.json({ message: 'Lead deleted' });
}));


// VISIBILITY TOGGLES
app.patch('/api/admin/users/:id/visibility', requireAdmin, asyncHandler(async (req, res) => {
  const { active } = req.body;
  const user = await one('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  await query('UPDATE users SET active = $1 WHERE id = $2', [asBool(active), req.params.id]);
  await logActivity(req.user.email, 'USER_VISIBILITY', `${user.email} -> ${asBool(active) ? 'active' : 'inactive'}`);
  res.json({ message: 'User visibility updated' });
}));

app.patch('/api/admin/plans/:id/visibility', requireAdmin, asyncHandler(async (req, res) => {
  const { active } = req.body;
  const plan = await one('SELECT id, name FROM plans WHERE id = $1', [req.params.id]);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  await query('UPDATE plans SET active = $1 WHERE id = $2', [asBool(active), req.params.id]);
  await logActivity(req.user.email, 'PLAN_VISIBILITY', `${plan.name} -> ${asBool(active) ? 'shown' : 'hidden'}`);
  res.json({ message: 'Plan visibility updated' });
}));

app.patch('/api/admin/services/:id/visibility', requireAdmin, asyncHandler(async (req, res) => {
  const { active } = req.body;
  const service = await one('SELECT id, title FROM services WHERE id = $1', [req.params.id]);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  await query('UPDATE services SET active = $1 WHERE id = $2', [asBool(active), req.params.id]);
  await logActivity(req.user.email, 'SERVICE_VISIBILITY', `${service.title} -> ${asBool(active) ? 'shown' : 'hidden'}`);
  res.json({ message: 'Service visibility updated' });
}));

app.patch('/api/admin/features/:id/visibility', requireAdmin, asyncHandler(async (req, res) => {
  const { active } = req.body;
  const feature = await one('SELECT id, title FROM features WHERE id = $1', [req.params.id]);
  if (!feature) return res.status(404).json({ error: 'Feature not found' });
  await query('UPDATE features SET active = $1 WHERE id = $2', [asBool(active), req.params.id]);
  await logActivity(req.user.email, 'FEATURE_VISIBILITY', `${feature.title} -> ${asBool(active) ? 'shown' : 'hidden'}`);
  res.json({ message: 'Feature visibility updated' });
}));

app.patch('/api/admin/industries/:id/visibility', requireAdmin, asyncHandler(async (req, res) => {
  const { active } = req.body;
  const industry = await one('SELECT id, name FROM industries WHERE id = $1', [req.params.id]);
  if (!industry) return res.status(404).json({ error: 'Industry not found' });
  await query('UPDATE industries SET active = $1 WHERE id = $2', [asBool(active), req.params.id]);
  await logActivity(req.user.email, 'INDUSTRY_VISIBILITY', `${industry.name} -> ${asBool(active) ? 'shown' : 'hidden'}`);
  res.json({ message: 'Industry visibility updated' });
}));

// LOCATION DATA
app.get('/api/locations/countries', asyncHandler(async (req, res) => {
  const countries = Country.getAllCountries().map((c) => ({
    name: c.name,
    isoCode: c.isoCode,
    phonecode: c.phonecode,
    flag: c.flag
  }));
  res.json({ countries });
}));

app.get('/api/locations/states/:countryCode', asyncHandler(async (req, res) => {
  const states = State.getStatesOfCountry(req.params.countryCode).map((s) => ({
    name: s.name,
    isoCode: s.isoCode,
    countryCode: s.countryCode
  }));
  res.json({ states });
}));

app.get('/api/locations/cities/:countryCode/:stateCode', asyncHandler(async (req, res) => {
  const cities = City.getCitiesOfState(req.params.countryCode, req.params.stateCode).map((c) => ({
    name: c.name,
    countryCode: c.countryCode,
    stateCode: c.stateCode
  }));
  res.json({ cities });
}));

// Legacy login page preserved
app.get('/login', (req, res) => {
  res.send(`
    <form method="POST" action="/login">
      <input name="username" placeholder="Username" />
      <input name="password" type="password" placeholder="Password" />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (username === LEGACY_LOGIN_USERNAME && password === LEGACY_LOGIN_PASSWORD) {
    await logApp('info', 'legacy_login_success', 'Legacy form login successful', { username });
    return res.redirect('/admin.html');
  }

  await logApp('warn', 'legacy_login_failed', 'Legacy form login failed', { username });
  return res.send('Invalid credentials');
}));

// SPA FALLBACK
app.get('*', (req, res) => {
  const file = req.path.includes('admin') ? 'admin.html' : 'index.html';
  res.sendFile(path.join(__dirname, 'public', file));
});

app.use(async (err, req, res, next) => {
  console.error(err);
  await logApp('error', 'unhandled_error', err.message || 'Unhandled server error', {
    path: req.path,
    method: req.method,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
  res.status(500).json({ error: 'Internal server error' });
});

initDB()
  .then(async () => {
    await logApp('info', 'server_start', 'OrbiTxt server booted', { port: PORT });
    app.listen(PORT, () => {
      console.log(`\n🚀 OrbiTxt Server running at http://localhost:${PORT}`);
      console.log(`📊 Admin Panel: http://localhost:${PORT}/admin.html`);
      console.log(`🔑 Admin login: ${process.env.ADMIN_EMAIL || 'admin@orbitxt.com'} / ${process.env.ADMIN_PASSWORD || 'Admin@123'}`);
      console.log(`👤 Demo client: ${process.env.DEMO_CLIENT_EMAIL || 'demo@acmecorp.com'} / ${process.env.DEMO_CLIENT_PASSWORD || 'Client@123'}\n`);
    });
  })
  .catch(async (err) => {
    console.error('Startup failed:', err);
    try {
      await logApp('error', 'server_start_failed', err.message || 'Startup failed');
    } catch (_) {
      // ignore secondary logging failure
    }
    process.exit(1);
  });
