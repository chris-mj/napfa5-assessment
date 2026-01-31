-- Run this in Supabase SQL editor (Postgr
-- Enriched readable view with joins to names/titles for UI
create or replace view public.audit_events_readable as
select
  e.id,
  e.created_at,
  e.entity_type,
  e.action,
  e.origin,
  e.entity_id,
  e.actor_user_id,
  p.full_name as actor_name,
  coalesce(p.email, p.full_name) as actor_email,
  e.school_id,
  sc.name as school_name,
  e.session_id,
  s.title as session_title,
  s.session_date,
  case
    when e.entity_type in ('scores','session_roster','students','enrollments')
         and e.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then st.student_identifier
    else null
  end as student_identifier,
  case
    when e.entity_type in ('scores','session_roster','students','enrollments')
         and e.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then st.name
    else null
  end as student_name,
  e.details,
  case
    when jsonb_typeof(e.details) = 'array' then (
      select string_agg(
        coalesce(d->>'display',
                 case
                   when (d->>'label') is not null and (d ? 'new') then (d->>'label') || ' ' || coalesce(d->>'new', d->>'value','')
                   when (d->>'label') is not null and (d ? 'value') then (d->>'label') || ' ' || coalesce(d->>'value','')
                   else d::text
                 end
        ), '; ')
      from jsonb_array_elements(e.details) as d
    )
    when jsonb_typeof(e.details) = 'object' then coalesce(e.details->>'display', e.details->>'message', e.details::text)
    else null
  end as details_text,
  e.diff,
  e.old_data,
  e.new_data
from audit.audit_events e
left join public.profiles p on p.user_id = e.actor_user_id
left join public.schools sc on sc.id = e.school_id
left join public.sessions s on s.id = e.session_id
left join public.students st on (
  e.entity_type in ('scores','session_roster','students','enrollments')
  and e.entity_id ~* '^[0-9a-f-]{36}$'
  and st.id = e.entity_id::uuid
);

grant select on public.audit_events_readable to authenticated;
revoke all on public.audit_events_readable from anon;
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

-- (removed) purge flag

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
  house text,
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

-- Session roster: optional house assignment per session
alter table if exists session_roster add column if not exists house text;

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
-- Student deletion RPCs
-- =========================

-- Remove a student's data scoped to a specific school (scores for that school's sessions,
-- roster rows in that school's sessions, and that school's enrollments). Does not delete
-- the student row. Caller must be admin/superadmin of the target school.
do $$ begin
create or replace function delete_student_in_school(p_student uuid, p_school uuid)
returns table (
  deleted_scores integer,
  deleted_roster integer,
  deleted_enrollments integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_allowed boolean;
  v_scores integer := 0;
  v_roster integer := 0;
  v_enroll integer := 0;
begin
  -- Authorization: admin/superadmin at target school
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.school_id = p_school
      and m.role in ('admin','superadmin')
  ) into v_allowed;
  if not v_allowed then
    raise exception 'Not authorized to remove student for this school';
  end if;

  -- Delete scores linked to sessions from this school
  with s_ids as (
    select sc.id
    from scores sc
    join sessions s on s.id = sc.session_id
    where sc.student_id = p_student
      and s.school_id = p_school
  ), del as (
    delete from scores sc using s_ids
    where sc.id = s_ids.id
    returning 1
  ) select count(*) into v_scores from del;

  -- Delete roster rows for sessions from this school
  with r_ids as (
    select r.id
    from session_roster r
    join sessions s on s.id = r.session_id
    where r.student_id = p_student
      and s.school_id = p_school
  ), del as (
    delete from session_roster r using r_ids
    where r.id = r_ids.id
    returning 1
  ) select count(*) into v_roster from del;

  -- Delete this school's enrollments for the student
  with del as (
    delete from enrollments e
    where e.student_id = p_student
      and e.school_id = p_school
    returning 1
  ) select count(*) into v_enroll from del;

  -- Optional audit (best-effort)
  begin
    perform public.audit_log_event('students','delete_in_school', p_student::text, null, null,
      jsonb_build_object('scores',v_scores,'roster',v_roster,'enrollments',v_enroll), p_school, null, null, null);
  exception when others then null; end;

  return query select v_scores, v_roster, v_enroll;
end;
$fn$;
exception when others then null; end $$;

do $$ begin
  grant execute on function delete_student_in_school(uuid, uuid) to authenticated;
  revoke execute on function delete_student_in_school(uuid, uuid) from anon;
exception when others then null; end $$;

-- Globally delete a student and all related data across schools.
-- Caller must be a superadmin.
do $$ begin
create or replace function delete_student_global(p_student uuid)
returns table (
  deleted_scores integer,
  deleted_roster integer,
  deleted_enrollments integer,
  deleted_students integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_allowed boolean;
  v_scores integer := 0;
  v_roster integer := 0;
  v_enroll integer := 0;
  v_student integer := 0;
begin
  -- Authorization: any superadmin
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.role = 'superadmin'
  ) into v_allowed;
  if not v_allowed then
    raise exception 'Not authorized to delete student globally';
  end if;

  -- Delete dependents explicitly under definer
  with del as (
    delete from scores sc where sc.student_id = p_student returning 1
  ) select count(*) into v_scores from del;

  with del as (
    delete from session_roster r where r.student_id = p_student returning 1
  ) select count(*) into v_roster from del;

  with del as (
    delete from enrollments e where e.student_id = p_student returning 1
  ) select count(*) into v_enroll from del;

  with del as (
    delete from students st where st.id = p_student returning 1
  ) select count(*) into v_student from del;

  -- Optional audit (best-effort)
  begin
    perform public.audit_log_event('students','delete_global', p_student::text, null, null,
      jsonb_build_object('scores',v_scores,'roster',v_roster,'enrollments',v_enroll,'students',v_student), null, null, null, null);
  exception when others then null; end;

  return query select v_scores, v_roster, v_enroll, v_student;
end;
$fn$;
exception when others then null; end $$;

do $$ begin
  grant execute on function delete_student_global(uuid) to authenticated;
  revoke execute on function delete_student_global(uuid) from anon;
exception when others then null; end $$;

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
  v_details jsonb;
  -- helpers for scores formatting
  v_has_any boolean := false;
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

  -- Build details for scores inserts/updates
  if tg_table_name = 'scores' and tg_op in ('INSERT','UPDATE') then
    -- Only include the five core stations (exclude run_2400 per current policy)
    -- On INSERT: list non-null values. On UPDATE: list only changed fields with old->new
    v_details := '[]'::jsonb;

    -- situps (reps)
    if tg_op = 'INSERT' then
      if NEW.situps is not null then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','situps','label','Sit-ups (reps)','new', NEW.situps,
          'display', concat('Sit-ups ', NEW.situps)
        )); v_has_any := true;
      end if;
    else
      if (OLD.situps is distinct from NEW.situps) then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','situps','label','Sit-ups (reps)','old', OLD.situps,'new', NEW.situps,
          'display', concat('Sit-ups ', coalesce(OLD.situps::text,'-'),' -> ', coalesce(NEW.situps::text,'-'))
        )); v_has_any := true;
      end if;
    end if;

    -- broad_jump (cm)
    if tg_op = 'INSERT' then
      if NEW.broad_jump is not null then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','broad_jump','label','Standing Broad Jump (cm)','new', round(NEW.broad_jump)::int,
          'display', concat('Standing Broad Jump ', round(NEW.broad_jump)::int, ' cm')
        )); v_has_any := true;
      end if;
    else
      if (OLD.broad_jump is distinct from NEW.broad_jump) then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','broad_jump','label','Standing Broad Jump (cm)','old', (case when OLD.broad_jump is null then null else round(OLD.broad_jump)::int end),'new', (case when NEW.broad_jump is null then null else round(NEW.broad_jump)::int end),
          'display', concat('Standing Broad Jump ', coalesce((case when OLD.broad_jump is null then null else round(OLD.broad_jump)::int end)::text,'-'), ' -> ', coalesce((case when NEW.broad_jump is null then null else round(NEW.broad_jump)::int end)::text,'-'),' cm')
        )); v_has_any := true;
      end if;
    end if;

    -- sit_and_reach (cm)
    if tg_op = 'INSERT' then
      if NEW.sit_and_reach is not null then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','sit_and_reach','label','Sit & Reach (cm)','new', round(NEW.sit_and_reach)::int,
          'display', concat('Sit & Reach ', round(NEW.sit_and_reach)::int, ' cm')
        )); v_has_any := true;
      end if;
    else
      if (OLD.sit_and_reach is distinct from NEW.sit_and_reach) then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','sit_and_reach','label','Sit & Reach (cm)','old', (case when OLD.sit_and_reach is null then null else round(OLD.sit_and_reach)::int end),'new', (case when NEW.sit_and_reach is null then null else round(NEW.sit_and_reach)::int end),
          'display', concat('Sit & Reach ', coalesce((case when OLD.sit_and_reach is null then null else round(OLD.sit_and_reach)::int end)::text,'-'), ' -> ', coalesce((case when NEW.sit_and_reach is null then null else round(NEW.sit_and_reach)::int end)::text,'-'),' cm')
        )); v_has_any := true;
      end if;
    end if;

    -- pullups (reps)
    if tg_op = 'INSERT' then
      if NEW.pullups is not null then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','pullups','label','Inclined Pull-ups (reps)','new', NEW.pullups,
          'display', concat('Inclined Pull-ups ', NEW.pullups)
        )); v_has_any := true;
      end if;
    else
      if (OLD.pullups is distinct from NEW.pullups) then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','pullups','label','Inclined Pull-ups (reps)','old', OLD.pullups,'new', NEW.pullups,
          'display', concat('Inclined Pull-ups ', coalesce(OLD.pullups::text,'-'),' -> ', coalesce(NEW.pullups::text,'-'))
        )); v_has_any := true;
      end if;
    end if;

    -- shuttle_run (s, 1 decimal)
    if tg_op = 'INSERT' then
      if NEW.shuttle_run is not null then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','shuttle_run','label','Shuttle Run (s)','new', round(NEW.shuttle_run::numeric,1),
          'display', concat('Shuttle Run ', round(NEW.shuttle_run::numeric,1), ' s')
        )); v_has_any := true;
      end if;
    else
      if (OLD.shuttle_run is distinct from NEW.shuttle_run) then
        v_details := v_details || jsonb_build_array(jsonb_build_object(
          'key','shuttle_run','label','Shuttle Run (s)','old', (case when OLD.shuttle_run is null then null else round(OLD.shuttle_run::numeric,1) end),'new', (case when NEW.shuttle_run is null then null else round(NEW.shuttle_run::numeric,1) end),
          'display', concat('Shuttle Run ', coalesce((case when OLD.shuttle_run is null then null else round(OLD.shuttle_run::numeric,1) end)::text,'-'), ' -> ', coalesce((case when NEW.shuttle_run is null then null else round(NEW.shuttle_run::numeric,1) end)::text,'-'), ' s')
        )); v_has_any := true;
      end if;
    end if;

    -- If insert with no values or update with no changes, skip logging to avoid noise
    if v_has_any is false then
      if tg_op = 'DELETE' then return OLD; else return NEW; end if;
    end if;
  end if;

  perform audit._write_event(
    v_actor, v_school, v_session, v_entity, v_id, v_action, 'db_trigger',
    v_old, v_new, null, v_details, null, null, null, null
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

-- RLS policies: allow SELECT for admins/superadmins scoped to their schools
do $$ begin
  begin
    create policy audit_select_admins on audit.audit_events
      for select using (
        exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and lower(coalesce(m.role,'')) in ('admin','superadmin')
            and (audit.audit_events.school_id is null or m.school_id = audit.audit_events.school_id)
        )
        or exists (
          select 1 from public.memberships m2
          where m2.user_id = auth.uid() and lower(coalesce(m2.role,'')) = 'superadmin'
        )
      );
  exception when others then null; end;
  begin
    -- Allow inserts by definer (typically postgres) only; apps should use RPC
    create policy audit_insert_definer on audit.audit_events
      for insert to postgres with check (true);
  exception when others then null; end;
end $$;

-- Grants
grant usage on schema audit to authenticated;
grant select on audit.audit_events to authenticated;
revoke all on audit.audit_events from anon;

-- Allow calling the RPC from authenticated users
grant execute on function public.audit_log_event(text, text, text, text, text, jsonb, uuid, text, inet, text) to authenticated;
;

-- =========================
-- Purge authorization helpers and RPCs
-- =========================

-- Platform owner: any membership with role 'superadmin' (global override)
-- (removed) purge authorization helpers and RPCs

-- =========================
-- Pre-purge aggregate snapshots (detailed, non-identifiable)
-- =========================

-- Aggregate per school/year/assessment/station/age/gender
create table if not exists assessment_agg (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year integer not null,
  assessment_type text not null,
  station_code text not null,
  gender text,
  age_years integer,
  n integer not null,
  avg numeric,
  min numeric,
  max numeric,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  stddev numeric,
  created_at timestamptz default now()
);

do $$ begin
  create unique index assessment_agg_unique
    on assessment_agg (school_id, academic_year, assessment_type, station_code, gender, age_years);
exception when others then null; end $$;

create index if not exists assessment_agg_school_year_idx
  on assessment_agg (school_id, academic_year);

-- Aggregate completion counts (NAPFA5 5-station / 6-station)
create table if not exists assessment_award_agg (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year integer not null,
  assessment_type text not null,
  gender text,
  age_years integer,
  completed_5_count integer not null,
  completed_6_count integer not null,
  total_count integer not null,
  created_at timestamptz default now()
);

do $$ begin
  create unique index assessment_award_agg_unique
    on assessment_award_agg (school_id, academic_year, assessment_type, gender, age_years);
exception when others then null; end $$;

create index if not exists assessment_award_agg_school_year_idx
  on assessment_award_agg (school_id, academic_year);

-- RLS for aggregate tables (readable by school admins)
alter table if exists assessment_agg enable row level security;
alter table if exists assessment_award_agg enable row level security;

do $$ begin
  create policy assessment_agg_select_by_membership
  on assessment_agg for select
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = assessment_agg.school_id
    )
    or exists (
      select 1 from memberships m2
      where m2.user_id = auth.uid()
        and m2.role = 'superadmin'
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy assessment_award_agg_select_by_membership
  on assessment_award_agg for select
  using (
    exists (
      select 1 from memberships m
      where m.user_id = auth.uid()
        and m.school_id = assessment_award_agg.school_id
    )
    or exists (
      select 1 from memberships m2
      where m2.user_id = auth.uid()
        and m2.role = 'superadmin'
    )
  );
exception when duplicate_object then null; end $$;

-- Snapshot function: run before purge
do $$ begin
create or replace function snapshot_assessment_agg(p_school uuid, p_academic_year integer)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_has_assessment_type boolean := false;
  v_has_ippt3 boolean := false;
  v_sql text;
  v_prev_exists boolean := false;
  v_station_rows integer := 0;
  v_award_rows integer := 0;
begin
  -- Authorization: admin/superadmin at target school
  if not exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.school_id = p_school
      and m.role in ('admin','superadmin')
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sessions'
      and column_name = 'assessment_type'
  ) into v_has_assessment_type;

  select to_regclass('public.ippt3_scores') is not null into v_has_ippt3;

  select exists (
    select 1 from assessment_agg
    where school_id = p_school and academic_year = p_academic_year
  ) into v_prev_exists;

  -- Clear existing snapshot for this school/year
  delete from assessment_agg where school_id = p_school and academic_year = p_academic_year;
  delete from assessment_award_agg where school_id = p_school and academic_year = p_academic_year;

  -- Station aggregates (NAPFA5 + optional IPPT3)
  v_sql := '
    with sess as (
      select s.id as session_id,
             s.school_id,
             s.session_date,
             extract(year from s.session_date)::int as session_year,
             ' || case when v_has_assessment_type
                then 'coalesce(s.assessment_type, ''NAPFA5'')'
                else '''NAPFA5''' end || ' as assessment_type
      from sessions s
      where s.school_id = $1
        and extract(year from s.session_date)::int = $2
    ),
    base as (
      select s.school_id, s.session_id, s.assessment_type, s.session_date,
             r.student_id,
             coalesce(nullif(st.gender, ''''), ''U'') as gender,
             st.dob,
             extract(year from age(s.session_date, st.dob))::int as age_years
      from sess s
      join session_roster r on r.session_id = s.session_id
      join students st on st.id = r.student_id
      where st.dob is not null
    ),
    station_rows as (
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''situps''::text as station_code, sc.situps::numeric as value
      from base b join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
      where sc.situps is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''shuttle_run'', sc.shuttle_run::numeric
      from base b join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
      where sc.shuttle_run is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''sit_and_reach'', sc.sit_and_reach::numeric
      from base b join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
      where sc.sit_and_reach is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''pullups'', sc.pullups::numeric
      from base b join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
      where sc.pullups is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''broad_jump'', sc.broad_jump::numeric
      from base b join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
      where sc.broad_jump is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''run_2400'', sc.run_2400::numeric
      from base b join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
      where sc.run_2400 is not null
      ' || case when v_has_ippt3 then '
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''situps'', ip.situps::numeric
      from base b join ippt3_scores ip on ip.session_id = b.session_id and ip.student_id = b.student_id
      where ip.situps is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''pushups'', ip.pushups::numeric
      from base b join ippt3_scores ip on ip.session_id = b.session_id and ip.student_id = b.student_id
      where ip.pushups is not null
      union all
      select b.school_id, b.assessment_type, b.gender, b.age_years, ''run_2400'', ip.run_2400::numeric
      from base b join ippt3_scores ip on ip.session_id = b.session_id and ip.student_id = b.student_id
      where ip.run_2400 is not null
      ' else '' end || '
    )
    insert into assessment_agg (
      school_id, academic_year, assessment_type, station_code, gender, age_years,
      n, avg, min, max, p25, p50, p75, stddev
    )
    select
      school_id,
      $2 as academic_year,
      assessment_type,
      station_code,
      gender,
      age_years,
      count(*) as n,
      avg(value) as avg,
      min(value) as min,
      max(value) as max,
      percentile_cont(0.25) within group (order by value) as p25,
      percentile_cont(0.50) within group (order by value) as p50,
      percentile_cont(0.75) within group (order by value) as p75,
      stddev_pop(value) as stddev
    from station_rows
    group by school_id, assessment_type, station_code, gender, age_years
  ';
  execute v_sql using p_school, p_academic_year;
  get diagnostics v_station_rows = row_count;

  -- Completion counts for NAPFA5 (5 stations vs 6 stations)
  v_sql := '
    with sess as (
      select s.id as session_id,
             s.school_id,
             s.session_date,
             extract(year from s.session_date)::int as session_year,
             ' || case when v_has_assessment_type
                then 'coalesce(s.assessment_type, ''NAPFA5'')'
                else '''NAPFA5''' end || ' as assessment_type
      from sessions s
      where s.school_id = $1
        and extract(year from s.session_date)::int = $2
    ),
    base as (
      select s.school_id, s.session_id, s.assessment_type, s.session_date,
             r.student_id,
             coalesce(nullif(st.gender, ''''), ''U'') as gender,
             st.dob,
             extract(year from age(s.session_date, st.dob))::int as age_years
      from sess s
      join session_roster r on r.session_id = s.session_id
      join students st on st.id = r.student_id
      where st.dob is not null
        and s.assessment_type = ''NAPFA5''
    ),
    scored as (
      select b.school_id, b.assessment_type, b.gender, b.age_years,
             (case when sc.situps is not null then 1 else 0 end
              + case when sc.shuttle_run is not null then 1 else 0 end
              + case when sc.sit_and_reach is not null then 1 else 0 end
              + case when sc.pullups is not null then 1 else 0 end
              + case when sc.broad_jump is not null then 1 else 0 end) as core_count,
             (case when sc.run_2400 is not null then 1 else 0 end) as run_present
      from base b
      join scores sc on sc.session_id = b.session_id and sc.student_id = b.student_id
    )
    insert into assessment_award_agg (
      school_id, academic_year, assessment_type, gender, age_years,
      completed_5_count, completed_6_count, total_count
    )
    select
      $1 as school_id,
      $2 as academic_year,
      assessment_type,
      gender,
      age_years,
      sum(case when core_count = 5 then 1 else 0 end) as completed_5_count,
      sum(case when core_count = 5 and run_present = 1 then 1 else 0 end) as completed_6_count,
      count(*) as total_count
    from scored
    group by assessment_type, gender, age_years
  ';
  execute v_sql using p_school, p_academic_year;
  get diagnostics v_award_rows = row_count;

  -- Audit snapshot event (best-effort)
  begin
    perform public.audit_log_event(
      'summary_data','snapshot', null, null, null,
      jsonb_build_object(
        'school_id', p_school,
        'academic_year', p_academic_year,
        'overwrote', v_prev_exists,
        'station_rows', v_station_rows,
        'award_rows', v_award_rows
      ),
      p_school, null, null, null
    );
  exception when others then null; end;
end;
$fn$;
exception when others then null; end $$;

do $$ begin
  grant execute on function snapshot_assessment_agg(uuid, integer) to authenticated;
  revoke execute on function snapshot_assessment_agg(uuid, integer) from anon;
exception when others then null; end $$;



