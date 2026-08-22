alter table if exists public.visits
  add column if not exists updated_at timestamptz;

alter table if exists public.visits
  add column if not exists notes text,
  add column if not exists recommendations text,
  add column if not exists implementation_notes text;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists visits_set_updated_at on public.visits;
create trigger visits_set_updated_at
  before update on public.visits
  for each row
  execute function public.set_updated_at();
