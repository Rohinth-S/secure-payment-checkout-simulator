alter table checkout_attempts add column if not exists provider_id text;
alter table checkout_attempts add column if not exists provider_status text;
