-- Run this in Supabase SQL editor (Postgres)
-- Idempotent schema + RLS policies for sessions, roster, scores

create extension if not exists pgcrypto;

-- =========================
-- Core tables
-- =========================

-- Profiles: app profile keyed by auth.users.id
create table if not exists profiles (
  user_id uuid primary key,
  full_name text,
  email text unique,
  created_at timestamptz default now(),
  constraint profiles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

-- Students: persistent identity across schools
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  student_identifier text unique,
  name text not null,
  gender text,
  dob date,
  created_at timestamptz default now()
);

-- Gender check (allow NULLs, but if present must be 'M' or 'F')
do $$ begin
  alter table if exists students
    add constraint students_gender_check check (gender in ('M','F'));
exception when others then null; end $$;

-- Schools
create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  type text,
  created_at timestamptz default now()
);

-- Restrict school type
do $$ begin
  alter table if exists schools
    add constraint schools_type_check check (type in ('primary','secondaryJC'));
exception when others then null; end $$;

-- Memberships: user roles per school
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  school_id uuid not null references schools(id) on delete cascade,
  role text not null,
  created_at timestamptz default now()
);
create index if not exists idx_memberships_user on memberships (user_id);
create index if not exists idx_memberships_school on memberships (school_id);

-- Optional FK to profiles for convenience
do $$ begin
  alter table if exists memberships
    add constraint memberships_user_id_fkey foreign key (user_id) references profiles(user_id) on delete cascade;
exception when others then null; end $$;

-- Enrollments: placement of a student within a school
create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  class text,
  academic_year integer,
  is_active boolean default true,
  created_at timestamptz default now()
);
create index if not exists idx_enrollments_school_year_class_active
  on enrollments (school_id, academic_year, class, is_active);
create index if not exists idx_enrollments_student_active on enrollments (student_id, is_active);

-- Ensure only one active enrollment per student
do $$ begin
  create unique index idx_enrollments_unique_active_per_student
    on enrollments (student_id) where is_active;
exception when others then null; end $$;

-- Sessions: per-school testing events
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  title text not null,
  session_date date not null,
  status text default 'draft' not null,
  created_by uuid,
  created_at timestamptz default now()
);
create index if not exists idx_sessions_school_date on sessions (school_id, session_date);
do $$ begin
  alter table if exists sessions
    add constraint sessions_status_check check (status in ('draft','active','completed'));
exception when others then null; end $$;

-- Session roster: link students to a session
create table if not exists session_roster (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  source text,
  added_at timestamptz default now(),
  unique (session_id, student_id)
);

-- Scores: one row per session+student for summary/best scores
create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  session_id uuid,
  test_date date,
  situps integer,
  shuttle_run real,
  sit_and_reach real,
  pullups integer,
  run_2400 real,
  broad_jump real,
  created_at timestamptz default now()
);

-- Link scores.session_id and enforce uniqueness per (session, student)
do $$ begin
  alter table if exists scores
    add constraint fk_scores_session foreign key (session_id) references sessions(id) on delete cascade;
exception when others then null; end $$;
do $$ begin
  create unique index idx_scores_unique_per_session_student on scores (session_id, student_id);
exception when others then null; end $$;

-- Stations: catalog of test stations
create table if not exists stations (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  unit text not null,
  max_attempts integer not null,
  order_index integer default 0,
  created_at timestamptz default now()
);

-- Attempts: normalized history of per-station attempts
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  station_id uuid not null references stations(id) on delete cascade,
  attempt_number integer not null,
  value_numeric numeric,
  value_text text,
  created_at timestamptz default now(),
  unique (session_id, student_id, station_id, attempt_number)
);

-- =========================
-- Role enum + migrations
-- =========================

-- Create enum role_type and migrate memberships.role text -> enum
do $$ begin
  create type role_type as enum ('admin','superadmin','score_taker');
exception when duplicate_object then null; end $$;

-- Normalize existing role strings and convert column to enum (guarded)
do $$ begin
  -- If the column exists and is text, normalize values
  perform 1 from information_schema.columns c
   where c.table_name = 'memberships' and c.column_name = 'role' and c.data_type = 'text';
  if found then
    update memberships set role = replace(lower(role), '-', '_') where role is not null;
    begin
      alter table memberships alter column role type role_type using replace(lower(role), '-', '_')::role_type;
    exception when others then null; end;
  end if;
exception when others then null; end $$;

-- =========================
-- Column hardening (idempotent)
-- =========================

-- Students
alter table if exists students alter column student_identifier set not null;
alter table if exists students alter column name set not null;
do $$ begin
  alter table if exists students add constraint students_student_identifier_unique unique (student_identifier);
exception when others then null; end $$;

-- Enrollments: ensure columns exist + types
alter table if exists enrollments add column if not exists class text;
alter table if exists enrollments add column if not exists academic_year integer;
alter table if exists enrollments alter column is_active set not null;

-- Sessions: ensure status column rules
alter table if exists sessions add column if not exists status text default 'draft';
update sessions set status = 'draft' where status is null;
alter table if exists sessions alter column status set not null;
do $$ begin
  alter table if exists sessions drop constraint if exists sessions_status_check;
  alter table if exists sessions add constraint sessions_status_check check (status in ('draft','active','completed'));
exception when others then null; end $$;

-- Scores: ensure session_id exists
alter table if exists scores add column if not exists session_id uuid;
do $$ begin
  alter table if exists scores
    add constraint scores_session_id_fkey foreign key (session_id) references sessions(id) on delete cascade;
exception when others then null; end $$;

-- =========================
-- Row Level Security (RLS)
-- =========================

-- Enable RLS on core tables
alter table if exists students enable row level security;
alter table if exists enrollments enable row level security;
alter table if exists sessions enable row level security;
alter table if exists session_roster enable row level security;
alter table if exists scores enable row level security;

-- Students: select by membership via enrollments; CUD by admin/superadmin
do $$ begin
  create policy students_select_by_enrollment
  on students for select
  using (
    exists (
      select 1 from enrollments e
      join memberships m on m.school_id = e.school_id
      where e.student_id = students.id
        and m.user_id = auth.uid()
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy students_admin_cud
  on students for all
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  ) with check (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  );
exception when duplicate_object then null; end $$;

-- Enrollments: select by membership; CUD by admin/superadmin in same school
do $$ begin
  create policy enrollments_select_by_membership
  on enrollments for select
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = enrollments.school_id
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy enrollments_admin_cud
  on enrollments for all
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = enrollments.school_id
        and m.role in ('admin','superadmin')
    )
  ) with check (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = enrollments.school_id
        and m.role in ('admin','superadmin')
    )
  );
exception when duplicate_object then null; end $$;

-- Sessions: select by membership; CUD by admin/superadmin
do $$ begin
  create policy sessions_select_by_membership
  on sessions for select
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = sessions.school_id
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy sessions_admin_cud
  on sessions for all
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = sessions.school_id
        and m.role in ('admin','superadmin')
    )
  ) with check (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = sessions.school_id
        and m.role in ('admin','superadmin')
    )
  );
exception when duplicate_object then null; end $$;

-- Session roster: select by membership; insert/update admin; delete admin if no scores
do $$ begin
  create policy session_roster_select_by_membership
  on session_roster for select
  using (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = session_roster.session_id
        and m.user_id = auth.uid()
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_roster_admin_insert_update
  on session_roster for insert to public
  with check (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = session_roster.session_id
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_roster_admin_update
  on session_roster for update using (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = session_roster.session_id
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  ) with check (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = session_roster.session_id
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy session_roster_admin_delete_guarded
  on session_roster for delete using (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = session_roster.session_id
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
    and not exists (
      select 1 from scores sc
      where sc.session_id = session_roster.session_id
        and sc.student_id = session_roster.student_id
    )
  );
exception when duplicate_object then null; end $$;

-- Scores: select by membership; I/U only when session active and role in allowed; D only when active and admin/superadmin
do $$ begin
  create policy scores_select_by_membership
  on scores for select
  using (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = scores.session_id
        and m.user_id = auth.uid()
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy scores_insert_when_active_with_role
  on scores for insert
  with check (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = scores.session_id
        and s.status = 'active'
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin','score_taker')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy scores_update_when_active_with_role
  on scores for update using (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = scores.session_id
        and s.status = 'active'
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin','score_taker')
    )
  ) with check (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = scores.session_id
        and s.status = 'active'
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin','score_taker')
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy scores_delete_when_active_admin
  on scores for delete using (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = scores.session_id
        and s.status = 'active'
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  );
exception when duplicate_object then null; end $$;

-- =========================
-- Verification helpers (read-only)
-- =========================

-- Tables RLS enabled
select 'RLS students' as label, relrowsecurity from pg_class where relname = 'students';
select 'RLS enrollments' as label, relrowsecurity from pg_class where relname = 'enrollments';
select 'RLS sessions' as label, relrowsecurity from pg_class where relname = 'sessions';
select 'RLS session_roster' as label, relrowsecurity from pg_class where relname = 'session_roster';
select 'RLS scores' as label, relrowsecurity from pg_class where relname = 'scores';

-- Key constraints
select 'students.gender_check' as label, conname from pg_constraint where conname = 'students_gender_check';
select 'sessions.status_check' as label, conname from pg_constraint where conname = 'sessions_status_check';
select 'enrollments.active_unique_idx' as label, indexrelid::regclass from pg_index where indexrelid::regclass::text = 'idx_enrollments_unique_active_per_student';
select 'scores.unique_idx' as label, indexrelid::regclass from pg_index where indexrelid::regclass::text = 'idx_scores_unique_per_session_student';


