-- Managing members (#26): owners change roles and remove members, members
-- leave. The existing policies allow those actions; this tightens updates and
-- lets someone who left (or was removed) be invited again.

-- A membership update may only change the role, and only within a trip the
-- caller owns. Before, WITH CHECK didn't re-check ownership, so an owner
-- could move a membership row into another trip by changing trip_id.
revoke update on public.trip_members from authenticated;
grant update (role) on public.trip_members to authenticated;

drop policy trip_members_update on public.trip_members;
create policy trip_members_update on public.trip_members
  for update to authenticated
  using (public.is_trip_owner(trip_id) and role <> 'owner')
  with check (public.is_trip_owner(trip_id) and role <> 'owner');

-- When a membership ends, drop the invite it was accepted from. Otherwise the
-- accepted invite stays hidden from the share dialog (which lists pending
-- invites only) and blocks inviting that email to the trip again.
create function public.handle_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.trip_invites i
  using auth.users u
  where u.id = old.user_id
    and i.trip_id = old.trip_id
    and i.email = lower(u.email)
    and i.accepted_at is not null;
  return old;
end;
$$;

create trigger on_member_removed
  after delete on public.trip_members
  for each row execute function public.handle_member_removed();
