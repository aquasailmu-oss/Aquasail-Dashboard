-- Make the booking RPCs added in 0035 immediately visible to PostgREST.
notify pgrst, 'reload schema';
