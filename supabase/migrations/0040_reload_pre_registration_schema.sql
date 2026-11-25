-- Refresh PostgREST after the pre-registration table and RPC changes in 0037
-- and 0039 so the list query and create RPC use the current schema.
notify pgrst, 'reload schema';
