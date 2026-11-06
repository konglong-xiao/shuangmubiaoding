CREATE TABLE site_login_attempts (
  client_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX site_login_attempts_window ON site_login_attempts (window_start);
