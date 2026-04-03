create table if not exists users (
  id bigserial primary key,
  email text unique not null,
  password_hash text not null,
  company_name text not null,
  role text not null default 'client' check (role in ('admin','client')),
  panel_url text,
  panel_username text,
  panel_password text,
  auto_login boolean not null default false,
  credits integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists plans (
  id bigserial primary key,
  name text not null,
  price integer not null default 0,
  currency text not null default 'INR',
  sms_count integer not null default 0,
  panels integer not null default 1,
  popular boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  features text not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists content (
  id bigserial primary key,
  section text not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  unique(section, key)
);

create table if not exists sections (
  id bigserial primary key,
  section_key text unique not null,
  label text not null,
  visible boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists stats (
  id bigserial primary key,
  label text not null,
  value text not null,
  sort_order integer not null default 0
);

create table if not exists features (
  id bigserial primary key,
  icon text not null,
  title text not null,
  description text not null,
  featured boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists services (
  id bigserial primary key,
  icon text not null,
  title text not null,
  description text not null,
  bullet_points text not null default '[]',
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists industries (
  id bigserial primary key,
  icon text not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0
);

create table if not exists leads (
  id bigserial primary key,
  name text not null,
  company text,
  email text not null,
  phone text not null,
  country_code text,
  country text,
  state text,
  city text,
  message text,
  source text not null default 'Demo Request',
  status text not null default 'new' check (status in ('new','contacted','qualified','converted','lost')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists activity_log (
  id bigserial primary key,
  admin_email text,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

create table if not exists app_logs (
  id bigserial primary key,
  level text not null,
  event text not null,
  message text,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_role on users(role);
create index if not exists idx_users_active on users(active);
create index if not exists idx_plans_active on plans(active);
create index if not exists idx_sections_visible on sections(visible);
create index if not exists idx_leads_status on leads(status);
create index if not exists idx_leads_created_at on leads(created_at desc);
create index if not exists idx_activity_log_created_at on activity_log(created_at desc);
create index if not exists idx_app_logs_created_at on app_logs(created_at desc);
create index if not exists idx_app_logs_level on app_logs(level);
