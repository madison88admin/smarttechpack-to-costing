begin;

-- Keep PBD pricing ownership separate from the factory CBD payload.
alter table tp_costing.costing_requests
  add column if not exists pbd_pricing jsonb not null default '{}'::jsonb,
  add column if not exists pbd_pricing_status text not null default 'pending',
  add column if not exists pbd_pricing_updated_at timestamptz,
  add column if not exists pbd_pricing_updated_by uuid;

-- A merchandising review is an auditable action before PBD approval. It does
-- not create a new costing status; a failed review routes the request back to
-- the existing factory clarification queue.
create index if not exists costing_requests_pbd_pricing_status_idx
  on tp_costing.costing_requests(pbd_pricing_status);

commit;
