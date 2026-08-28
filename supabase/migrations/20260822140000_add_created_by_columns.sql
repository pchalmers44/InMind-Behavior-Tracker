do $$
declare
  target_table text;
  fk_name text;
  has_auth_users_fk boolean;
  invalid_owner_count bigint;
begin
  foreach target_table in array array['visits', 'observations', 'students', 'classrooms']
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists created_by uuid',
      target_table
    );

    execute format(
      'alter table public.%I alter column created_by set default auth.uid()',
      target_table
    );

    select exists (
      select 1
      from pg_constraint constraint_record
      join pg_attribute attribute_record
        on attribute_record.attrelid = constraint_record.conrelid
       and attribute_record.attnum = any(constraint_record.conkey)
      where constraint_record.conrelid = format('public.%I', target_table)::regclass
        and constraint_record.contype = 'f'
        and constraint_record.confrelid = 'auth.users'::regclass
        and attribute_record.attname = 'created_by'
    )
    into has_auth_users_fk;

    if not has_auth_users_fk then
      fk_name := target_table || '_created_by_fkey';
      execute format(
        'alter table public.%I add constraint %I foreign key (created_by) references auth.users(id) not valid',
        target_table,
        fk_name
      );
    end if;

    execute format(
      'select count(*) from public.%I t left join auth.users u on u.id = t.created_by where t.created_by is not null and u.id is null',
      target_table
    )
    into invalid_owner_count;

    if invalid_owner_count = 0 then
      fk_name := target_table || '_created_by_fkey';
      if exists (
        select 1
        from pg_constraint
        where conrelid = format('public.%I', target_table)::regclass
          and conname = fk_name
          and not convalidated
      ) then
        execute format('alter table public.%I validate constraint %I', target_table, fk_name);
      end if;
    else
      raise notice 'public.% has % created_by value(s) that do not match auth.users.id; foreign key left NOT VALID until those rows are corrected.',
        target_table,
        invalid_owner_count;
    end if;
  end loop;
end;
$$;
