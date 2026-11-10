-- Cria o banco separado usado pelo serviço Go (wamux_go).
-- Precisa ser separado do banco do gateway porque ambos têm uma tabela
-- `instances` — compartilhar o mesmo banco causaria colisão de schema.
--
-- Só roda no PRIMEIRO boot do Postgres (volume vazio). Se você já subiu o
-- Postgres antes de adicionar isto, crie manualmente:
--   docker compose exec postgres psql -U whatsapp -c "CREATE DATABASE wamux;"
SELECT 'CREATE DATABASE wamux'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'wamux')\gexec
