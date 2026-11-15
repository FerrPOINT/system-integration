-- Keep frequently changed task pages eligible for regular vacuum; see performance journal E46.
ALTER TABLE tasks SET (autovacuum_vacuum_scale_factor=0.05);
