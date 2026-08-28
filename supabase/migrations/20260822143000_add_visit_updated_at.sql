do $$
begin
  if to_regclass('public.visits') is null then
    return;
  end if;

  alter table public.visits
    add column if not exists updated_at timestamptz,
    add column if not exists notes text,
    add column if not exists recommendations text,
    add column if not exists implementation_notes text;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.visits') is null then
    return;
  end if;

  drop trigger if exists visits_set_updated_at on public.visits;
  create trigger visits_set_updated_at
    before update on public.visits
    for each row
    execute function public.set_updated_at();
end;
$$;
