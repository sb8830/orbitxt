require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add your Supabase Postgres connection string to the environment.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function one(text, params = []) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function many(text, params = []) {
  const result = await query(text, params);
  return result.rows;
}

async function exec(text) {
  await pool.query(text);
}

async function logApp(level, event, message = '', meta = {}) {
  try {
    await query(
      `INSERT INTO app_logs (level, event, message, meta_json)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [level, event, message, JSON.stringify(meta || {})]
    );
  } catch (err) {
    console.error('Failed to write app log:', err.message);
  }
}

async function logActivity(adminEmail, action, details = '') {
  await query(
    'INSERT INTO activity_log (admin_email, action, details) VALUES ($1, $2, $3)',
    [adminEmail || null, action, details]
  );
  await logApp('info', 'admin_activity', action, { adminEmail: adminEmail || null, details });
}

async function initSchema() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      company_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
      panel_url TEXT,
      panel_username TEXT,
      panel_password TEXT,
      auto_login BOOLEAN NOT NULL DEFAULT FALSE,
      credits INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS plans (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      sms_count INTEGER NOT NULL DEFAULT 0,
      panels INTEGER NOT NULL DEFAULT 1,
      popular BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      features TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS content (
      id BIGSERIAL PRIMARY KEY,
      section TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (section, key)
    );

    CREATE TABLE IF NOT EXISTS sections (
      id BIGSERIAL PRIMARY KEY,
      section_key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      visible BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stats (
      id BIGSERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS features (
      id BIGSERIAL PRIMARY KEY,
      icon TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      icon TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      bullet_points TEXT NOT NULL DEFAULT '[]',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS industries (
      id BIGSERIAL PRIMARY KEY,
      icon TEXT NOT NULL,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      country_code TEXT,
      country TEXT,
      state TEXT,
      city TEXT,
      message TEXT,
      source TEXT NOT NULL DEFAULT 'Demo Request',
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGSERIAL PRIMARY KEY,
      admin_email TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_logs (
      id BIGSERIAL PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      message TEXT,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
    CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(active);
    CREATE INDEX IF NOT EXISTS idx_sections_visible ON sections(visible);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
  `);
}

async function upsertUserByEmail({ email, password, company_name, role = 'client', panel_url = null, panel_username = null, panel_password = null, auto_login = false, credits = 0, active = true }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail) return;
  const password_hash = bcrypt.hashSync(password, 10);
  await query(
    `INSERT INTO users (
       email, password_hash, company_name, role, panel_url,
       panel_username, panel_password, auto_login, credits, active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       company_name = EXCLUDED.company_name,
       role = EXCLUDED.role,
       panel_url = EXCLUDED.panel_url,
       panel_username = EXCLUDED.panel_username,
       panel_password = EXCLUDED.panel_password,
       auto_login = EXCLUDED.auto_login,
       credits = EXCLUDED.credits,
       active = EXCLUDED.active`,
    [
      normalizedEmail,
      password_hash,
      company_name,
      role,
      panel_url,
      panel_username,
      panel_password,
      !!auto_login,
      Number(credits || 0),
      !!active
    ]
  );
}

async function seedUsers() {
  const adminEmail = (process.env.ADMIN_EMAIL || process.env.ADMIN_USERNAME || 'admin@orbitxt.com').toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const adminCompany = process.env.ADMIN_COMPANY_NAME || 'OrbiTxt Technologies';

  let demoEmail = (process.env.DEMO_CLIENT_EMAIL || 'demo@acmecorp.com').toLowerCase().trim();
  const demoPassword = process.env.DEMO_CLIENT_PASSWORD || 'Client@123';
  const demoCompany = process.env.DEMO_CLIENT_COMPANY || 'AcmeCorp';

  await upsertUserByEmail({
    email: adminEmail,
    password: adminPassword,
    company_name: adminCompany,
    role: 'admin',
    panel_url: null,
    panel_username: null,
    panel_password: null,
    auto_login: false,
    credits: 0,
    active: true
  });

  if (demoEmail === adminEmail) {
    demoEmail = 'demo@acmecorp.com';
  }

  await upsertUserByEmail({
    email: demoEmail,
    password: demoPassword,
    company_name: demoCompany,
    role: 'client',
    panel_url: process.env.DEMO_CLIENT_PANEL_URL || 'https://panel.acmecorp.com/dashboard',
    panel_username: process.env.DEMO_CLIENT_PANEL_USERNAME || 'acme_user',
    panel_password: process.env.DEMO_CLIENT_PANEL_PASSWORD || 'AcmePass@123',
    auto_login: false,
    credits: 50000,
    active: true
  });
}

async function seedPlans() {
  const row = await one('SELECT COUNT(*)::int AS c FROM plans');
  if (row.c > 0) return;

  const plansData = [
    {
      name: 'Starter',
      price: 999,
      sms_count: 10000,
      panels: 1,
      popular: false,
      sort_order: 1,
      features: JSON.stringify(['10,000 SMS/month', 'Basic analytics', 'Email support', 'API access'])
    },
    {
      name: 'Growth',
      price: 2999,
      sms_count: 50000,
      panels: 3,
      popular: true,
      sort_order: 2,
      features: JSON.stringify(['50,000 SMS/month', 'Advanced analytics', 'Priority support', 'Full API access', 'Custom domain', 'Voice calls'])
    },
    {
      name: 'Enterprise',
      price: 0,
      sms_count: -1,
      panels: -1,
      popular: false,
      sort_order: 3,
      features: JSON.stringify(['Unlimited SMS', 'Dedicated manager', 'SLA guarantee', 'Custom integrations', 'White-label option', '24/7 support'])
    }
  ];

  for (const p of plansData) {
    await query(
      `INSERT INTO plans (name, price, sms_count, panels, popular, sort_order, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [p.name, p.price, p.sms_count, p.panels, p.popular, p.sort_order, p.features]
    );
  }
}

async function seedContent() {
  const row = await one('SELECT COUNT(*)::int AS c FROM content');
  if (row.c > 0) return;

  const contentData = [
    ['hero', 'badge', 'Smart Messaging Solutions'],
    ['hero', 'headline', 'Powering Your Business Communication with Smart Messaging Solutions.'],
    ['hero', 'subheadline', 'Seamless SMS & Voice Communication Services designed to boost engagement, automate interactions, and scale your business effortlessly.'],
    ['hero', 'cta_primary', 'Get Started'],
    ['hero', 'cta_secondary', 'Request Demo'],
    ['site', 'company_name', 'OrbiTxt Technologies'],
    ['site', 'tagline', 'Smart Messaging Solutions'],
    ['site', 'support_email', 'support@orbitxt.com'],
    ['site', 'sales_email', 'sales@orbitxt.com'],
    ['site', 'phone', '+91 98765 43210'],
    ['site', 'footer_text', 'Technology-driven communication solutions provider specializing in bulk SMS and voice-based marketing services.'],
    ['about', 'title', 'About Us'],
    ['about', 'emoji', '🚀'],
    ['about', 'description', "We are a technology-driven communication solutions provider specializing in bulk SMS and voice-based marketing services. Our mission is to help businesses connect with their audience instantly, effectively, and affordably."],
    ['about', 'sub_description', "Whether it's promotional campaigns, transactional alerts, OTP delivery, or customer engagement, we provide reliable and scalable solutions tailored to your needs."],
    ['services', 'title', 'Our Services'],
    ['why_us', 'title', 'Why Choose Us'],
    ['technology', 'title', 'Our Technology'],
    ['technology', 'description', 'We leverage advanced communication gateways and cloud-based infrastructure to ensure instant message delivery, high uptime & redundancy, smart routing for better reach, and real-time analytics & monitoring. Our platform is built to handle millions of messages daily without compromising performance.'],
    ['industries', 'title', 'Industries We Serve'],
    ['pricing', 'title', 'Simple, Transparent Pricing'],
    ['pricing', 'subtitle', 'Choose a plan that fits your business. Scale up anytime.'],
    ['cta', 'headline', 'Ready to Scale Your Business Communication?'],
    ['cta', 'subtext', 'Join thousands of businesses using OrbiTxt to power their SMS and voice campaigns — reliably, affordably, at scale.'],
    ['cta', 'button', 'Get Started Today']
  ];

  for (const [section, key, value] of contentData) {
    await query(
      `INSERT INTO content (section, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (section, key) DO NOTHING`,
      [section, key, value]
    );
  }
}

async function seedSections() {
  const row = await one('SELECT COUNT(*)::int AS c FROM sections');
  if (row.c > 0) return;

  const sectionsData = [
    { section_key: 'hero', label: 'Hero / Banner', visible: true, sort_order: 1 },
    { section_key: 'stats', label: 'Stats Bar', visible: true, sort_order: 2 },
    { section_key: 'about', label: 'About Us', visible: true, sort_order: 3 },
    { section_key: 'services', label: 'Our Services', visible: true, sort_order: 4 },
    { section_key: 'why_us', label: 'Why Choose Us', visible: true, sort_order: 5 },
    { section_key: 'technology', label: 'Our Technology', visible: true, sort_order: 6 },
    { section_key: 'industries', label: 'Industries We Serve', visible: true, sort_order: 7 },
    { section_key: 'pricing', label: 'Pricing Plans', visible: true, sort_order: 8 },
    { section_key: 'cta', label: 'Call to Action', visible: true, sort_order: 9 }
  ];

  for (const s of sectionsData) {
    await query(
      `INSERT INTO sections (section_key, label, visible, sort_order)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (section_key) DO NOTHING`,
      [s.section_key, s.label, s.visible, s.sort_order]
    );
  }
}

async function seedStats() {
  const row = await one('SELECT COUNT(*)::int AS c FROM stats');
  if (row.c > 0) return;

  const stats = [
    ['Uptime SLA', '99.9%', 1],
    ['Cities Covered', '500+', 2],
    ['SMS / Day', '1M+', 3],
    ['Happy Clients', '200+', 4]
  ];

  for (const [label, value, sort_order] of stats) {
    await query('INSERT INTO stats (label, value, sort_order) VALUES ($1, $2, $3)', [label, value, sort_order]);
  }
}

async function seedFeatures() {
  const row = await one('SELECT COUNT(*)::int AS c FROM features');
  if (row.c > 0) return;

  const features = [
    ['⚡', 'High Delivery Speed & Reliability', 'Lightning-fast message delivery with intelligent routing across all carriers for maximum reach.', true, 1],
    ['💰', 'Best Pricing in the Market', 'Competitive pricing with no hidden charges. Pay only for what you use with flexible plans.', false, 2],
    ['🔒', 'Secure & Compliant Infrastructure', 'TRAI compliant, GDPR-ready, with end-to-end encrypted messaging and audit trails.', false, 3],
    ['📈', 'Scalable for Any Business Size', 'From startups to enterprises — our platform scales seamlessly with your growth.', false, 4],
    ['🛠️', '24/7 Technical Support', 'Round-the-clock support team ready to resolve any issue and keep your campaigns running.', false, 5],
    ['🌐', 'Pan-India Coverage', 'Complete coverage across all Indian states and telecom circles with multi-gateway redundancy.', false, 6]
  ];

  for (const [icon, title, description, featured, sort_order] of features) {
    await query(
      'INSERT INTO features (icon, title, description, featured, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [icon, title, description, featured, sort_order]
    );
  }
}

async function seedServices() {
  const row = await one('SELECT COUNT(*)::int AS c FROM services');
  if (row.c > 0) return;

  const services = [
    ['📩', 'Bulk SMS Services', 'Send targeted SMS campaigns at scale with real-time delivery reports and high open rates.', JSON.stringify(['Promotional SMS campaigns', 'Transactional SMS (OTP, alerts)', 'Personalized messaging at scale', 'High delivery rate with real-time reports']), 1],
    ['📞', 'Voice Call Solutions', 'Automate your voice communications with IVR systems and outbound call campaigns.', JSON.stringify(['Automated voice calls (IVR)', 'Promotional voice campaigns', 'Appointment reminders & alerts', 'Interactive customer engagement']), 2],
    ['⚙️', 'API Integration', 'Integrate messaging into your existing systems with our developer-friendly REST APIs.', JSON.stringify(['Easy-to-integrate SMS & Voice APIs', 'Developer-friendly documentation', 'Real-time delivery tracking', 'Secure and scalable infrastructure']), 3],
    ['📊', 'Smart Campaign Management', 'Control, analyze, and automate your campaigns from a single powerful dashboard.', JSON.stringify(['Dashboard for campaign control', 'Detailed analytics & reporting', 'Scheduling & automation tools', 'Audience segmentation']), 4]
  ];

  for (const [icon, title, description, bullet_points, sort_order] of services) {
    await query(
      'INSERT INTO services (icon, title, description, bullet_points, sort_order) VALUES ($1, $2, $3, $4, $5)',
      [icon, title, description, bullet_points, sort_order]
    );
  }
}

async function seedIndustries() {
  const row = await one('SELECT COUNT(*)::int AS c FROM industries');
  if (row.c > 0) return;

  const industries = [
    ['🛒', 'E-commerce', 1],
    ['🏦', 'Banking & Finance', 2],
    ['🏥', 'Healthcare', 3],
    ['🎓', 'Education', 4],
    ['🏠', 'Real Estate', 5],
    ['🚀', 'Startups & Enterprises', 6]
  ];

  for (const [icon, name, sort_order] of industries) {
    await query('INSERT INTO industries (icon, name, sort_order) VALUES ($1, $2, $3)', [icon, name, sort_order]);
  }
}

async function initDB() {
  await initSchema();
  await seedUsers();
  await seedPlans();
  await seedContent();
  await seedSections();
  await seedStats();
  await seedFeatures();
  await seedServices();
  await seedIndustries();
  await logApp('info', 'db_init', 'Supabase/Postgres schema checked and seed completed');
  return { query, one, many, logActivity, logApp, pool };
}

module.exports = {
  initDB,
  query,
  one,
  many,
  logActivity,
  logApp,
  pool
};
