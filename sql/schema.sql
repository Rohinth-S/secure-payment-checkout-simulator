create table if not exists checkout_attempts (
  id text primary key,
  idempotency_key text not null unique,
  order_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null,
  status text not null check (status in ('authorized','review','declined')),
  fraud_score integer not null check (fraud_score between 0 and 100),
  fraud_reasons jsonb not null default '[]'::jsonb,
  token_fingerprint text not null,
  provider_id text,
  provider_status text,
  created_at timestamptz not null default now()
);
create index if not exists checkout_attempts_order_idx on checkout_attempts(order_id);
