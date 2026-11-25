-- The gas-price Edge Function fills gas_price_cache with the service-role
-- client. Grant that explicitly (like the other grants) rather than relying on
-- the project's default privileges. Signed-in users keep read-only access.
grant select, insert, update on public.gas_price_cache to service_role;
