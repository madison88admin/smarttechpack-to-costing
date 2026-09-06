-- 015: stamp factory_cbds.submitted_at with the database clock.
--
-- Root cause (found live 2026-09-06): the app inserted submitted_at from the
-- client clock while outlier acknowledgements carry approval_actions.created_at
-- from the database clock. Client clocks running ~30s ahead of the database
-- made fresh acks compare OLDER than the CBD, so the outlier gate looped 409
-- forever. Single-clock rule: the app omits submitted_at on submit and the DB
-- defaults it; drafts keep inserting explicit null.

alter table if exists tp_costing.factory_cbds
  alter column submitted_at set default now();

insert into tp_costing.schema_migrations(version, description)
values ('015', 'DB-clock default for factory_cbds.submitted_at (outlier-ack freshness)')
on conflict (version) do update
set description = excluded.description, applied_at = now();
