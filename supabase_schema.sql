
-- Run this in Supabase SQL editor (Postgres)
create extension if not exists pgcrypto;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text,
  student_id text,
  gender text,
  dob date,
  class text
);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  test_date date,
  situps integer,
  shuttle_run real,
  sit_and_reach real,
  pullups integer,
  run_2400 real,
  broad_jump real,
  created_at timestamptz default now()
);
