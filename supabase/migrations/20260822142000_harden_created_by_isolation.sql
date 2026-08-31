create or replace function public.is_observation_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.role(), '') = 'service_role'
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) in ('admin', 'super_admin')
    or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'is_admin', 'false')) = 'true';
$$;

create or replace function public.prevent_created_by_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by
     and coalesce(auth.role(), '') <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'created_by cannot be modified';
  end if;

  return new;
end;
$$;

do $$
declare
  target_table text;
  trigger_name text;
  select_policy text;
  insert_policy text;
  update_policy text;
  delete_policy text;
  not_null_constraint text;
  null_owner_count bigint;
begin
  foreach target_table in array array['visits', 'observations', 'students', 'classrooms']
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = target_table
        and c.column_name = 'created_by'
    ) then
      raise notice 'Skipping public.% RLS hardening because created_by does not exist.', target_table;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);
    execute format('alter table public.%I force row level security', target_table);
    execute format('revoke update (created_by) on public.%I from anon, authenticated', target_table);

    not_null_constraint := target_table || '_created_by_not_null';
    if not exists (
      select 1
      from pg_constraint
      where conrelid = format('public.%I', target_table)::regclass
        and conname = not_null_constraint
    ) then
      execute format(
        'alter table public.%I add constraint %I check (created_by is not null) not valid',
        target_table,
        not_null_constraint
      );
    end if;

    execute format('select count(*) from public.%I where created_by is null', target_table)
      into null_owner_count;

    if null_owner_count = 0 then
      if exists (
        select 1
        from pg_constraint
        where conrelid = format('public.%I', target_table)::regclass
          and conname = not_null_constraint
          and not convalidated
      ) then
        execute format('alter table public.%I validate constraint %I', target_table, not_null_constraint);
      end if;
    else
      raise exception 'public.% has % existing NULL created_by row(s). Run a manual ownership backfill before enabling RLS so existing production data is not hidden.',
        target_table,
        null_owner_count;
    end if;

    select_policy := target_table || '_select_own';
    insert_policy := target_table || '_insert_own';
    update_policy := target_table || '_update_own';
    delete_policy := target_table || '_delete_admin';

    execute format('drop policy if exists %I on public.%I', select_policy, target_table);
    execute format('drop policy if exists %I on public.%I', insert_policy, target_table);
    execute format('drop policy if exists %I on public.%I', update_policy, target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_delete_own', target_table);
    execute format('drop policy if exists %I on public.%I', delete_policy, target_table);

    execute format(
      'create policy %I on public.%I for select to authenticated using (created_by = auth.uid() or public.is_observation_admin())',
      select_policy,
      target_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (created_by is not null and (created_by = auth.uid() or public.is_observation_admin()))',
      insert_policy,
      target_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (created_by = auth.uid() or public.is_observation_admin()) with check (created_by is not null and (created_by = auth.uid() or public.is_observation_admin()))',
      update_policy,
      target_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_observation_admin())',
      delete_policy,
      target_table
    );

    execute format('create index if not exists %I on public.%I (created_by)', 'idx_' || target_table || '_created_by', target_table);

    trigger_name := target_table || '_prevent_created_by_update';
    execute format('drop trigger if exists %I on public.%I', trigger_name, target_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_created_by_update()',
      trigger_name,
      target_table
    );
  end loop;

  if to_regclass('public.visits') is not null
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'visits' and c.column_name = 'created_by'
     )
     and exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'visits' and c.column_name = 'start_time'
     ) then
    execute 'create index if not exists idx_visits_created_by_start_time on public.visits (created_by, start_time desc)';
  end if;

  if to_regclass('public.visits') is not null
     and not exists (
       select 1
       from unnest(array['created_by', 'district', 'school_name', 'start_time']) as required_column(column_name)
       where not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = 'visits' and c.column_name = required_column.column_name
       )
     ) then
    execute 'create index if not exists idx_visits_created_by_district_school_start_time on public.visits (created_by, district, school_name, start_time desc)';
  end if;

  if to_regclass('public.visits') is not null
     and not exists (
       select 1
       from unnest(array['created_by', 'type', 'subject_name', 'start_time']) as required_column(column_name)
       where not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = 'visits' and c.column_name = required_column.column_name
       )
     ) then
    execute 'create index if not exists idx_visits_created_by_type_subject_start_time on public.visits (created_by, type, subject_name, start_time desc)';
  end if;

  if to_regclass('public.observations') is not null
     and not exists (
       select 1
       from unnest(array['created_by', 'created_at']) as required_column(column_name)
       where not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = 'observations' and c.column_name = required_column.column_name
       )
     ) then
    execute 'create index if not exists idx_observations_created_by_created_at on public.observations (created_by, created_at desc)';
  end if;

  if to_regclass('public.observations') is not null
     and not exists (
       select 1
       from unnest(array['created_by', 'district', 'school', 'student_name', 'teacher_name', 'created_at']) as required_column(column_name)
       where not exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = 'observations' and c.column_name = required_column.column_name
       )
     ) then
    execute 'create index if not exists idx_observations_created_by_report_filters on public.observations (created_by, district, school, student_name, teacher_name, created_at desc)';
  end if;
end;
$$;
