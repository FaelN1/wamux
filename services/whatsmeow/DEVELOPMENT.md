# Desenvolvimento

## Pre-requisitos

- Go 1.22+
- Docker e Docker Compose
- GCC (necessario para CGO/SQLite)

## Setup inicial

```bash
# 1. Copiar variaveis de ambiente
# Linux/Mac:
cp .env.example .env
# Windows (CMD):
copy .env.example .env
# Windows (PowerShell):
Copy-Item .env.example .env

# 2. Editar o .env conforme necessario (MASTER_API_KEY obrigatorio)
```

## Subir apenas o banco de dados

```bash
docker compose up -d postgres
```

O PostgreSQL estara disponivel em `localhost:5432` com as credenciais do `docker-compose.yml` (user/password/wamux).

Para verificar se subiu:

```bash
docker compose ps
docker compose logs postgres
```

## Rodar em modo desenvolvimento

```bash
# 1. Garantir que o banco esta rodando
docker compose up -d postgres

# 2. Rodar a aplicacao
go run cmd/server/main.go
```

O servidor inicia em `http://localhost:3000`.
O painel admin fica em `http://localhost:3000/manager`.

## Migrations

As migrations rodam **automaticamente** ao iniciar a aplicacao. Nao e necessario executar nenhum comando separado.

O codigo responsavel esta em `internal/database/database.go` na funcao `RunMigrations()`. Ela cria as tabelas `instances` e `webhook_deliveries` com seus indices usando `CREATE TABLE IF NOT EXISTS`, entao e seguro rodar multiplas vezes.

## Subir tudo com Docker (producao)

```bash
docker compose up -d --build
```

## Comandos uteis

```bash
# Parar tudo
docker compose down

# Parar tudo e apagar os volumes (reset total do banco)
docker compose down -v

# Ver logs do banco
docker compose logs -f postgres

# Acessar o banco via psql
docker compose exec postgres psql -U user -d wamux

# Build do binario
go build -o server cmd/server/main.go

# Verificar codigo
go vet ./...
```
