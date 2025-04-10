-- Up Migration

ALTER TABLE ft_transfer_events REPLICA IDENTITY FULL;

-- Down Migration

ALTER TABLE ft_transfer_events REPLICA IDENTITY DEFAULT;