do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select
      conrelid::regclass as table_name,
      conname as constraint_name
    from pg_constraint
    where contype = 'c'
      and connamespace = 'public'::regnamespace
      and conrelid in (
        select table_oid
        from unnest(array[
          to_regclass('public.visits'),
          to_regclass('public.observations'),
          to_regclass('public.students'),
          to_regclass('public.classrooms')
        ]) as scoped_tables(table_oid)
        where table_oid is not null
      )
      and pg_get_constraintdef(oid) ~* 'behaviors?'
      and pg_get_constraintdef(oid) ~* '(jsonb?_array_length|array_length|cardinality)'
      and pg_get_constraintdef(oid) ~* '(<\s*4|<=\s*3)'
  loop
    execute format(
      'alter table %s drop constraint if exists %I',
      constraint_record.table_name,
      constraint_record.constraint_name
    );
  end loop;
end;
$$;
