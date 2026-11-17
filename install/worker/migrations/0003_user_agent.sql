-- Record the client's User-Agent header again (dropped in 0002) so script readers, crawlers and real
-- installers can be told apart. The Worker stores it trimmed to 200 printable characters; it never stores
-- the address or anything derived from it. Existing rows keep NULL.
ALTER TABLE install_events ADD COLUMN user_agent TEXT;
