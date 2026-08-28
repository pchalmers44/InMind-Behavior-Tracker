do $$
declare
  target_table text;
  owner_column text;
  single_user_id uuid;
  auth_user_count integer;
  remaining_null_count bigint;
begin
  select count(*), min(id)
    into auth_user_count, single_user_id
  from auth.users;

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
      continue;
    end if;

    foreach owner_column in array array['user_id', 'owner_id', 'created_by_user_id']
    loop
      if exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = target_table
          and c.column_name = owner_column
          and c.udt_name = 'uuid'
      ) then
        execute format(
          'update public.%I t set created_by = t.%I from auth.users u where t.created_by is null and t.%I = u.id',
          target_table,
          owner_column,
          owner_column
        );
      end if;
    end loop;

    if auth_user_count = 1 and single_user_id is not null then
      execute format(
        'update public.%I set created_by = $1 where created_by is null',
        target_table
      )
      using single_user_id;
    end if;

    execute format('select count(*) from public.%I where created_by is null', target_table)
      into remaining_null_count;

    if remaining_null_count > 0 then
      raise notice 'public.% still has % rows with NULL created_by; assign ownership with a service-role/manual backfill before observer-only production access is required.',
        target_table,
        remaining_null_count;
    end if;
  end loop;
end;
$$;
