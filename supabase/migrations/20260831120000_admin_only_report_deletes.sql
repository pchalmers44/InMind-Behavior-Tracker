do $$
declare
  target_table text;
  delete_policy text;
begin
  foreach target_table in array array['visits', 'observations', 'students', 'classrooms']
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    delete_policy := target_table || '_delete_admin';

    execute format('drop policy if exists %I on public.%I', target_table || '_delete_own', target_table);
    execute format('drop policy if exists %I on public.%I', delete_policy, target_table);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_observation_admin())',
      delete_policy,
      target_table
    );
  end loop;
end $$;
