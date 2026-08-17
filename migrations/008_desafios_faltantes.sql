-- =====================================================================
-- 008_desafios_faltantes.sql
-- El portal ofrece cinco desafios pero solo tres existian como registros.
-- Los minijuegos de phishing y de proteccion de datos mostraban su pantalla
-- de victoria y no otorgaban nada, porque su desafio no estaba en la base.
--
-- Los valores replican los que el portal anuncia en la vista de desafios.
-- Depende de: schema.sql (tabla challenges)
-- =====================================================================

INSERT INTO challenges (id, name, points_reward) VALUES
    ('phishing', 'Detector de Phishing',  100),
    ('data',     'Proteccion de Datos',   200)
ON CONFLICT (id) DO NOTHING;
