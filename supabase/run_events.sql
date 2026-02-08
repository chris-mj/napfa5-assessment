create table if not exists run_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  session_id text not null,
  station_id text,
  event_type text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table run_events enable row level security;

create policy "run_events_insert" on run_events
  for insert
  to authenticated
  with check (true);

create policy "run_events_read" on run_events
  for select
  to authenticated
  using (true);
