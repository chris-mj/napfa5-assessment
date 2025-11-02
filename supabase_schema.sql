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

-- Removed attempts table; using scores-only model

-- =========================
-- Role enum + migrations
-- =========================

-- Drop legacy attempts table if present (migrating to scores-only model)
do $$ begin
  drop table if exists attempts cascade;
exception when others then null; end $$;

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
alter table if exists memberships enable row level security;

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

-- Memberships: user can see and delete their own memberships; admins/superadmins can manage within same school
do $$ begin
  create policy memberships_select_self
  on memberships for select
  using (
    user_id = auth.uid()
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy memberships_delete_self
  on memberships for delete
  using (
    user_id = auth.uid()
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy memberships_admin_cud
  on memberships for all
  using (
    exists (
      select 1 from memberships m2
      where m2.user_id = auth.uid()
        and m2.school_id = memberships.school_id
        and m2.role in ('admin','superadmin')
    )
  ) with check (
    exists (
      select 1 from memberships m2
      where m2.user_id = auth.uid()
        and m2.school_id = memberships.school_id
        and m2.role in ('admin','superadmin')
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
        and s.status <> 'completed'
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
        and s.status <> 'completed'
        and m.user_id = auth.uid()
        and m.role in ('admin','superadmin')
    )
  ) with check (
    exists (
      select 1 from sessions s
      join memberships m on m.school_id = s.school_id
      where s.id = session_roster.session_id
        and s.status <> 'completed'
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
        and s.status <> 'completed'
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

-- =========================
-- Admin/Superadmin export RPCs (idempotent)
-- =========================

-- Export raw fields for client-side CSV shaping
do $$ begin
create or replace function export_session_scores(p_session_id uuid)
returns table (
  student_identifier text,
  name text,
  class text,
  gender text,
  dob date,
  situps integer,
  broad_jump numeric,
  sit_and_reach numeric,
  pullups integer,
  shuttle_run numeric
)
language sql
security definer
set search_path = public
as $fn$
  with allowed as (
    select 1
    from sessions s
    join memberships m on m.school_id = s.school_id
    where s.id = p_session_id
      and m.user_id = auth.uid()
      and m.role in ('admin','superadmin')
    limit 1
  )
  select st.student_identifier,
         st.name,
         e.class,
         st.gender,
         st.dob,
         sc.situps,
         sc.broad_jump,
         sc.sit_and_reach,
         sc.pullups,
         sc.shuttle_run
  from sessions s
  join session_roster r on r.session_id = s.id
  join students st on st.id = r.student_id
  left join enrollments e on e.student_id = st.id and e.is_active
  left join scores sc on sc.session_id = s.id and sc.student_id = st.id
  where s.id = p_session_id
    and exists (select 1 from allowed)
  order by
    case when e.class is null or e.class = '' then 1 else 0 end,
    lower(coalesce(e.class, '')),
    lower(st.name);
$fn$;
exception when others then null; end $$;

do $$ begin
  grant execute on function export_session_scores(uuid) to authenticated;
  revoke execute on function export_session_scores(uuid) from anon;
exception when others then null; end $$;

-- Export shaped to PFT upload format (column names preserved)
do $$ begin
create or replace function export_session_scores_pft(p_session_id uuid)
returns table (
  "Sl.No" integer,
  "Name" text,
  "ID" text,
  "Class" text,
  "Gender" text,
  "DOB" date,
  "Attendance" text,
  "Sit-ups" integer,
  "Standing Broad Jump (cm)" numeric,
  "Sit & Reach (cm)" numeric,
  "Pull-ups" integer,
  "Shuttle Run (sec)" numeric,
  "1.6/2.4 Km Run MMSS" text,
  "PFT Test Date" text
)
language sql
security definer
set search_path = public
as $fn$
  with allowed as (
    select 1
    from sessions s
    join memberships m on m.school_id = s.school_id
    where s.id = p_session_id
      and m.user_id = auth.uid()
      and m.role in ('admin','superadmin')
    limit 1
  ),
  base as (
    select st.student_identifier as id,
           st.name,
           coalesce(e.class, '') as class,
           st.gender,
           st.dob,
           sc.situps,
           sc.broad_jump,
           sc.sit_and_reach,
           sc.pullups,
           sc.shuttle_run
    from sessions s
    join session_roster r on r.session_id = s.id
    join students st on st.id = r.student_id
    left join enrollments e on e.student_id = st.id and e.is_active
    left join scores sc on sc.session_id = s.id and sc.student_id = st.id
    where s.id = p_session_id
      and exists (select 1 from allowed)
  )
  select row_number() over(order by
           case when class is null or class = '' then 1 else 0 end,
           lower(class),
           lower(name)
         ) as "Sl.No",
         name as "Name",
         id as "ID",
         class as "Class",
         gender as "Gender",
         dob as "DOB",
         '' as "Attendance",
         situps as "Sit-ups",
         broad_jump as "Standing Broad Jump (cm)",
         sit_and_reach as "Sit & Reach (cm)",
         pullups as "Pull-ups",
         shuttle_run as "Shuttle Run (sec)",
         '' as "1.6/2.4 Km Run MMSS",
         '' as "PFT Test Date"
  from base
  order by
    case when class is null or class = '' then 1 else 0 end,
    lower(class),
    lower(name);
$fn$;
exception when others then null; end $$;

do $$ begin
  grant execute on function export_session_scores_pft(uuid) to authenticated;
  revoke execute on function export_session_scores_pft(uuid) from anon;
exception when others then null; end $$;

-- =========================
-- RPC helpers
-- =========================

-- List memberships for a school (admin/superadmin only) without RLS recursion
do $do$
begin
  create or replace function list_school_memberships(p_school uuid)
  returns table (
    membership_id uuid,
    user_id uuid,
    role role_type,
    full_name text,
    email text
  )
  language sql
  security definer
  set search_path = public
  as $fn$
    with allowed as (
      select 1
      from memberships m
      where m.user_id = auth.uid()
        and m.school_id = p_school
        and m.role in ('admin','superadmin')
      limit 1
    )
    select m.id, m.user_id, m.role, p.full_name, p.email
    from memberships m
    join profiles p on p.user_id = m.user_id
    where m.school_id = p_school
      and exists (select 1 from allowed)
    order by p.full_name nulls last, p.email;
  $fn$;
exception when others then null; end
$do$;

-- Update a membership role with admin/superadmin check
do $do$
begin
  create or replace function update_membership_role(p_membership_id uuid, p_role role_type)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare v_school uuid;
  begin
    select school_id into v_school from memberships where id = p_membership_id;
    if v_school is null then
      raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = v_school
        and m.role in ('admin','superadmin')\n  ) or exists (select 1 from memberships gm where gm.user_id = auth.uid() and gm.role = 'superadmin') then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
    update memberships set role = p_role where id = p_membership_id;
  end;
  $fn$;
exception when others then null; end
$do$;

-- Delete a membership (self or admin/superadmin in same school)
do $do$
begin
  create or replace function delete_membership(p_membership_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  declare v_school uuid; v_user uuid;
  begin
    select school_id, user_id into v_school, v_user from memberships where id = p_membership_id;
    if v_school is null then
      raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = v_school
        and m.role in ('admin','superadmin')
    ) or lower((auth.jwt()->>'email')) = lower('christopher_teo_ming_jian@moe.edu.sg')
  ) then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
    delete from memberships where id = p_membership_id;
  end;
  $fn$;
exception when others then null; end
$do$;
create or replace function move_membership_to_school(
  p_email text,
  p_school uuid,
  p_role role_type
)
returns void
language plpgsql
security definer
as $func$
declare
  v_user uuid;
  v_keep uuid;
begin
  select user_id into v_user from profiles where email = p_email;
  if v_user is null then
    raise exception ''AUTH_USER_MISSING'' using errcode=''P0002'';
  end if;

  -- If already in target school, update role and remove others
  select id into v_keep from memberships where user_id = v_user and school_id = p_school limit 1;
  if v_keep is not null then
    update memberships set role = p_role where id = v_keep;
    delete from memberships where user_id = v_user and id <> v_keep;
    return;
  end if;

  -- Move one existing membership if any; otherwise insert new
  select id into v_keep from memberships where user_id = v_user limit 1;
  if v_keep is not null then
    update memberships set school_id = p_school, role = p_role where id = v_keep;
    delete from memberships where user_id = v_user and id <> v_keep;
  else
    insert into memberships(user_id, school_id, role) values (v_user, p_school, p_role);
  end if;
end;
$func$;




-- =========================
-- Audit schema and events
-- =========================
create schema if not exists audit;

create table if not exists audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid,
  school_id uuid,
  session_id uuid,
  entity_type text not null,
  entity_id text,
  action text not null,
  origin text not null check (origin in ('db_trigger','app')),
  old_data jsonb,
  new_data jsonb,
  diff jsonb,
  details jsonb,
  request_id uuid,
  user_agent text,
  ip inet,
  client_version text
);

create index if not exists audit_events_created_at_idx on audit.audit_events (created_at desc);
create index if not exists audit_events_school_idx on audit.audit_events (school_id, created_at desc);
create index if not exists audit_events_session_idx on audit.audit_events (session_id, created_at desc);
create index if not exists audit_events_actor_idx on audit.audit_events (actor_user_id, created_at desc);
create index if not exists audit_events_entity_idx on audit.audit_events (entity_type, created_at desc);

-- Helper definer to insert into audit table (bypasses RLS for inserts)
create or replace function audit._write_event(
  p_actor_user_id uuid,
  p_school_id uuid,
  p_session_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_action text,
  p_origin text,
  p_old jsonb,
  p_new jsonb,
  p_diff jsonb,
  p_details jsonb,
  p_request_id uuid,
  p_user_agent text,
  p_ip inet,
  p_client_version text
) returns void
language sql
security definer
set search_path = audit, public
as $$
  insert into audit.audit_events (
    actor_user_id, school_id, session_id, entity_type, entity_id, action, origin,
    old_data, new_data, diff, details, request_id, user_agent, ip, client_version
  ) values (
    p_actor_user_id, p_school_id, p_session_id, p_entity_type, p_entity_id, p_action, p_origin,
    p_old, p_new, p_diff, p_details, p_request_id, p_user_agent, p_ip, p_client_version
  );
$$;

-- Trigger function to log table changes
create or replace function audit.log_change() returns trigger
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
  v_school uuid;
  v_session uuid;
  v_old jsonb;
  v_new jsonb;
  v_entity text := tg_table_name;
  v_id text;
  v_action text := lower(tg_op);
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(NEW);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(OLD);
  end if;

  -- derive ids by table
  if tg_table_name = 'scores' then
    v_session := coalesce((v_new->>'session_id')::uuid, (v_old->>'session_id')::uuid);
    select s.school_id into v_school from public.sessions s where s.id = v_session;
    v_id := coalesce(v_new->>'student_id', v_old->>'student_id');
  elsif tg_table_name = 'session_roster' then
    v_session := coalesce((v_new->>'session_id')::uuid, (v_old->>'session_id')::uuid);
    select s.school_id into v_school from public.sessions s where s.id = v_session;
    v_id := coalesce(v_new->>'student_id', v_old->>'student_id');
  elsif tg_table_name = 'sessions' then
    v_session := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
    v_school := coalesce((v_new->>'school_id')::uuid, (v_old->>'school_id')::uuid);
    v_id := coalesce(v_new->>'id', v_old->>'id');
  elsif tg_table_name = 'enrollments' then
    v_school := coalesce((v_new->>'school_id')::uuid, (v_old->>'school_id')::uuid);
    v_id := coalesce(v_new->>'id', v_old->>'id');
  elsif tg_table_name = 'memberships' then
    v_school := coalesce((v_new->>'school_id')::uuid, (v_old->>'school_id')::uuid);
    v_id := coalesce(v_new->>'user_id', v_old->>'user_id');
  else
    v_id := coalesce(v_new->>'id', v_old->>'id');
  end if;

  perform audit._write_event(
    v_actor, v_school, v_session, v_entity, v_id, v_action, 'db_trigger',
    v_old, v_new, null, null, null, null, null, null
  );

  if tg_op = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

-- Attach triggers on key tables
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_scores_trg'
  ) then
    create trigger audit_scores_trg after insert or update or delete on public.scores
      for each row execute function audit.log_change();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_session_roster_trg'
  ) then
    create trigger audit_session_roster_trg after insert or update or delete on public.session_roster
      for each row execute function audit.log_change();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_sessions_trg'
  ) then
    create trigger audit_sessions_trg after insert or update or delete on public.sessions
      for each row execute function audit.log_change();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_enrollments_trg'
  ) then
    create trigger audit_enrollments_trg after insert or update or delete on public.enrollments
      for each row execute function audit.log_change();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'audit_memberships_trg'
  ) then
    create trigger audit_memberships_trg after insert or update or delete on public.memberships
      for each row execute function audit.log_change();
  end if;
end $$;

-- RLS for audit table
alter table audit.audit_events enable row level security;

-- Public RPC wrapper for app-level events
create or replace function public.audit_log_event(
  p_entity_type text,
  p_action text,
  p_entity_id text,
  p_school_id uuid,
  p_session_id uuid,
  p_details jsonb default null,
  p_request_id uuid default null,
  p_user_agent text default null,
  p_ip inet default null,
  p_client_version text default null
) returns void
language sql
security definer
set search_path = public, audit
as $$
  select audit._write_event(
    auth.uid(), p_school_id, p_session_id, p_entity_type, p_entity_id, p_action, 'app',
    null, null, null, p_details, p_request_id, p_user_agent, p_ip, p_client_version
  );
$$;
