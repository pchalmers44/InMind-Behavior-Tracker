do $$
declare
  target_table text;
begin
  foreach target_table in array array['visits', 'observations', 'students', 'classrooms']
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    execute format('grant delete on public.%I to authenticated', target_table);
  end loop;
end $$;
