create or replace function public.prevent_created_by_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be modified';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
  trigger_name text;
begin
  foreach table_name in array array['visits', 'observations', 'students', 'classrooms']
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists created_by uuid references auth.users(id) default auth.uid()',
      table_name
    );

    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke update (created_by) on public.%I from anon, authenticated', table_name);

    execute format('drop policy if exists "%I_select_own" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_insert_own" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_update_own" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%I_delete_own" on public.%I', table_name, table_name);

    execute format(
      'create policy "%I_select_own" on public.%I for select to authenticated using (created_by = auth.uid())',
      table_name,
      table_name
    );
    execute format(
      'create policy "%I_insert_own" on public.%I for insert to authenticated with check (created_by = auth.uid())',
      table_name,
      table_name
    );
    execute format(
      'create policy "%I_update_own" on public.%I for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid())',
      table_name,
      table_name
    );
    execute format(
      'create policy "%I_delete_own" on public.%I for delete to authenticated using (created_by = auth.uid())',
      table_name,
      table_name
    );

    trigger_name := format('%s_prevent_created_by_update', table_name);
    execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_created_by_update()',
      trigger_name,
      table_name
    );
  end loop;
end;
$$;
