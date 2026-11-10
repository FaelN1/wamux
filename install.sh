#!/usr/bin/env bash
#
# Instalador interativo do WAMux.
#
#   curl -fsSL https://raw.githubusercontent.com/FaelN1/wamux/main/install.sh | bash
#
# O que faz: confere os pré-requisitos (git, Docker, Compose), baixa o projeto,
# pergunta as configurações, gera o .env com segredos fortes e sobe a stack com
# Docker Compose. Não instala nada no sistema sem perguntar e nunca sobrescreve
# um .env existente sem backup.
#
# Opções:
#   --dir <pasta>     pasta de instalação (padrão: ./wamux)
#   --branch <nome>   branch/tag a instalar (padrão: main)
#   --yes             não pergunta nada: usa os padrões e gera os segredos
#   --no-start        só prepara (.env), não sobe os containers
#   -h, --help        mostra esta ajuda
#
# Compatível com bash 3.2+ (macOS) e Linux.

set -euo pipefail

REPO_URL="${WAMUX_REPO_URL:-https://github.com/FaelN1/wamux.git}"
BRANCH="${WAMUX_BRANCH:-main}"
INSTALL_DIR="${WAMUX_DIR:-}"
ASSUME_YES=0
NO_START=0

# ── apresentação ─────────────────────────────────────────────

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' RED=$'\033[31m' GREEN=$'\033[32m'
  YELLOW=$'\033[33m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' CYAN='' RESET=''
fi

step() { printf '\n%s▸ %s%s\n' "$BOLD$CYAN" "$1" "$RESET"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
info() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
die() {
  printf '\n%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Instalador interativo do WAMux.

  curl -fsSL https://raw.githubusercontent.com/FaelN1/wamux/main/install.sh | bash
  curl -fsSL https://raw.githubusercontent.com/FaelN1/wamux/main/install.sh | bash -s -- --dir /opt/wamux

Opções:
  --dir <pasta>     pasta de instalação (padrão: ./wamux)
  --branch <nome>   branch/tag a instalar (padrão: main)
  --yes             não pergunta nada: usa os padrões e gera os segredos
  --no-start        só prepara (.env), não sobe os containers
  -h, --help        mostra esta ajuda
EOF
  exit 0
}

# ── argumentos ───────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      [ $# -ge 2 ] || die "--dir precisa de um valor"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --branch)
      [ $# -ge 2 ] || die "--branch precisa de um valor"
      BRANCH="$2"
      shift 2
      ;;
    --yes | -y)
      ASSUME_YES=1
      shift
      ;;
    --no-start)
      NO_START=1
      shift
      ;;
    -h | --help) usage ;;
    *) die "Opção desconhecida: $1 (use --help)" ;;
  esac
done

# ── entrada interativa ───────────────────────────────────────
# Com `curl … | bash` o stdin é o próprio script: as perguntas leem do terminal.

TTY=''
if [ "$ASSUME_YES" -eq 0 ]; then
  if [ -t 0 ]; then
    TTY=/dev/stdin
  elif { : </dev/tty; } 2>/dev/null; then
    TTY=/dev/tty
  else
    die "Sem terminal para as perguntas. Rode num terminal interativo ou use --yes para aceitar os padrões."
  fi
fi

# ask <variável> <pergunta> [padrão]
ask() {
  local __var="$1" __prompt="$2" __default="${3:-}" __reply=''
  if [ "$ASSUME_YES" -eq 1 ]; then
    printf -v "$__var" '%s' "$__default"
    return
  fi
  if [ -n "$__default" ]; then
    printf '  %s %s[%s]%s: ' "$__prompt" "$DIM" "$__default" "$RESET"
  else
    printf '  %s: ' "$__prompt"
  fi
  IFS= read -r __reply <"$TTY" || __reply=''
  printf -v "$__var" '%s' "${__reply:-$__default}"
}

# ask_secret <variável> <pergunta> — não ecoa; vazio é aceito.
ask_secret() {
  local __var="$1" __prompt="$2" __reply=''
  if [ "$ASSUME_YES" -eq 1 ]; then
    printf -v "$__var" '%s' ''
    return
  fi
  printf '  %s: ' "$__prompt"
  IFS= read -rs __reply <"$TTY" || __reply=''
  printf '\n'
  printf -v "$__var" '%s' "$__reply"
}

# confirm <pergunta> <s|n padrão> → 0 = sim
confirm() {
  local __prompt="$1" __default="${2:-n}" __reply='' __hint='s/N'
  [ "$__default" = "s" ] && __hint='S/n'
  if [ "$ASSUME_YES" -eq 1 ]; then
    [ "$__default" = "s" ]
    return
  fi
  printf '  %s %s[%s]%s: ' "$__prompt" "$DIM" "$__hint" "$RESET"
  IFS= read -r __reply <"$TTY" || __reply=''
  __reply="${__reply:-$__default}"
  case "$__reply" in
    s | S | sim | Sim | SIM | y | Y | yes) return 0 ;;
    *) return 1 ;;
  esac
}

has() { command -v "$1" >/dev/null 2>&1; }

# Segredo hexadecimal (seguro em URL, YAML e shell).
gen_secret() {
  local bytes="${1:-24}"
  if has openssl; then
    openssl rand -hex "$bytes"
  else
    LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c $((bytes * 2))
  fi
}

# set_env <arquivo> <CHAVE> <valor> — troca a linha da chave ou acrescenta.
# O valor vai por variável de ambiente para o awk não interpretar `\` ou `&`.
set_env() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp)"
  KEY="$key" VALUE="$value" awk '
    BEGIN { key = ENVIRON["KEY"]; value = ENVIRON["VALUE"]; done = 0 }
    index($0, key "=") == 1 { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$file" >"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

get_env() { # get_env <arquivo> <CHAVE>
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -n 1
}

port_in_use() {
  local port="$1"
  if has lsof; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif has ss; then
    ss -ltn 2>/dev/null | grep -q "[:.]$port[[:space:]]"
  elif has nc; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 1
  fi
}

# ── 1. pré-requisitos ────────────────────────────────────────

printf '%s\n' "${BOLD}WAMux — instalação${RESET}"
info "Gateway de WhatsApp multi-engine (Baileys · Cloud API · whatsmeow)"

step "Conferindo o que já está instalado"

OS="$(uname -s)"
case "$OS" in
  Linux | Darwin) ok "Sistema: $OS $(uname -m)" ;;
  *) die "Sistema não suportado: $OS. No Windows, use o WSL2." ;;
esac

if has git; then
  ok "git $(git --version | awk '{print $3}')"
else
  die "git não encontrado. Instale o git e rode de novo (https://git-scm.com/downloads)."
fi

if ! has docker; then
  warn "Docker não encontrado."
  if [ "$OS" = "Linux" ] && has curl; then
    info "Posso instalar pelo script oficial da Docker (https://get.docker.com) — ele usa sudo."
    if confirm "Instalar o Docker agora?" n; then
      curl -fsSL https://get.docker.com | sh
      if has sudo && [ "$(id -u)" -ne 0 ]; then
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        warn "Seu usuário foi adicionado ao grupo docker. Abra um novo terminal (ou rode 'newgrp docker') e execute o instalador de novo."
        exit 0
      fi
    else
      die "Instale o Docker (https://docs.docker.com/engine/install/) e rode de novo."
    fi
  else
    die "Instale o Docker Desktop (https://docs.docker.com/get-docker/) e rode de novo."
  fi
fi
ok "Docker $(docker --version | sed 's/Docker version //; s/,.*//')"

if docker compose version >/dev/null 2>&1; then
  ok "Docker Compose $(docker compose version --short 2>/dev/null || echo v2)"
else
  die "O plugin 'docker compose' (v2) não foi encontrado. Atualize o Docker ou instale o plugin: https://docs.docker.com/compose/install/"
fi

if docker info >/dev/null 2>&1; then
  ok "Docker em execução"
else
  die "O Docker está instalado, mas não responde. Abra o Docker Desktop (ou 'sudo systemctl start docker') — e, no Linux, confira se seu usuário está no grupo docker."
fi

has curl || warn "curl não encontrado — não vou conseguir conferir a saúde da API ao final."
has openssl || info "openssl não encontrado — os segredos serão gerados a partir de /dev/urandom."

# ── 2. código ────────────────────────────────────────────────

step "Baixando o WAMux"

# Rodando de dentro de um clone? Usa a própria pasta.
if [ -z "$INSTALL_DIR" ] && [ -f docker-compose.yml ] && [ -f .env.example ] && grep -q '^name: wamux' docker-compose.yml 2>/dev/null; then
  INSTALL_DIR="$(pwd)"
  ok "Usando o projeto já baixado em $INSTALL_DIR"
else
  [ -n "$INSTALL_DIR" ] || ask INSTALL_DIR "Pasta de instalação" "$(pwd)/wamux"
  if [ -d "$INSTALL_DIR/.git" ]; then
    ok "Projeto já existe em $INSTALL_DIR"
    if confirm "Atualizar para a versão mais recente de '$BRANCH'?" s; then
      if git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH" >/dev/null 2>&1; then
        ok "Atualizado"
      else
        warn "Não consegui atualizar (alterações locais ou histórico divergente). Sigo com a versão que está na pasta."
      fi
    fi
  elif [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    die "A pasta $INSTALL_DIR já existe e não é uma instalação do WAMux. Escolha outra com --dir."
  else
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" >/dev/null 2>&1 ||
      die "Falha ao baixar $REPO_URL (branch $BRANCH). Confira sua conexão."
    ok "Baixado em $INSTALL_DIR"
  fi
fi

cd "$INSTALL_DIR"
[ -f .env.example ] && [ -f docker-compose.yml ] || die "Pasta inesperada: faltam .env.example / docker-compose.yml em $INSTALL_DIR."

# ── 3. configuração ──────────────────────────────────────────

step "Configuração"

CONFIGURE=1
if [ -f .env ]; then
  ok "Já existe um .env nesta pasta."
  if confirm "Manter a configuração atual?" s; then
    CONFIGURE=0
  else
    BACKUP=".env.bak-$(date +%Y%m%d-%H%M%S)"
    cp .env "$BACKUP"
    chmod 600 "$BACKUP" 2>/dev/null || true
    ok "Backup salvo em $BACKUP"
  fi
fi

if [ "$CONFIGURE" -eq 1 ]; then
  # Reconfigurando: os valores atuais viram o padrão de cada pergunta, e as
  # senhas de banco/broker são preservadas (os volumes já foram criados com elas).
  PREV=''
  [ -f .env ] && PREV=.env

  prev() { [ -n "$PREV" ] && get_env "$PREV" "$1" || true; }

  info "Enter aceita o valor entre colchetes."

  DEFAULT_URL="$(prev PUBLIC_BASE_URL)"
  ask PUBLIC_URL "URL pública do gateway (a que seus clientes e a Meta vão chamar)" "${DEFAULT_URL:-http://localhost:3000}"
  PUBLIC_URL="${PUBLIC_URL%/}"
  case "$PUBLIC_URL" in
    http://* | https://*) ;;
    *) die "A URL pública precisa começar com http:// ou https://" ;;
  esac

  GLOBAL_KEY="$(prev GLOBAL_API_KEY)"
  case "$GLOBAL_KEY" in '' | change-me | troque-*) GLOBAL_KEY='' ;; esac
  if [ -n "$GLOBAL_KEY" ]; then
    confirm "Manter a chave de administração (GLOBAL_API_KEY) atual?" s || GLOBAL_KEY=''
  fi
  if [ -z "$GLOBAL_KEY" ]; then
    ask_secret GLOBAL_KEY "Chave de administração (Enter = gerar uma forte)"
    if [ -z "$GLOBAL_KEY" ]; then
      GLOBAL_KEY="$(gen_secret 24)"
      ok "Chave de administração gerada (aparece no resumo final)."
    elif [ "${#GLOBAL_KEY}" -lt 16 ]; then
      die "A chave de administração precisa ter ao menos 16 caracteres."
    fi
  fi

  DB_PASS="$(prev DB_PASSWORD)"
  MQ_PASS="$(prev RABBITMQ_PASS)"
  WM_KEY="$(prev WHATSMEOW_MASTER_KEY)"
  if [ -z "$PREV" ]; then
    DB_PASS="$(gen_secret 16)"
    MQ_PASS="$(gen_secret 16)"
    WM_KEY="$(gen_secret 24)"
    ok "Senhas do Postgres, do RabbitMQ e a chave do sidecar whatsmeow geradas."
    if docker volume inspect wamux_pgdata >/dev/null 2>&1; then
      warn "Já existe um volume de banco (wamux_pgdata) de uma instalação anterior, criado com OUTRA senha."
      warn "O Postgres não troca a senha de um volume existente: a API não vai conectar."
      info "Se os dados antigos não importam, apague os volumes: docker compose down -v"
      confirm "Continuar mesmo assim?" n || die "Instalação interrompida. Nada foi alterado no banco."
    fi
  else
    case "$WM_KEY" in '' | troque-*) WM_KEY="$(gen_secret 24)" ;; esac
    [ -n "$DB_PASS" ] || DB_PASS=whatsapp
    [ -n "$MQ_PASS" ] || MQ_PASS=wamux
    ok "Senhas de banco e broker preservadas."
  fi

  printf '\n'
  info "Inbox: guarda conversas, contatos e mensagens no Postgres (conteúdo fica em repouso no banco)."
  SAVE_INBOX=false
  confirm "Ativar a persistência do Inbox?" n && SAVE_INBOX=true

  info "Logs: auditoria das chamadas à API e dos eventos, visível no painel."
  SAVE_LOGS=false
  confirm "Ativar o painel de Logs/Atividade?" n && SAVE_LOGS=true

  printf '\n'
  CLOUD_VERIFY="$(prev CLOUD_API_VERIFY_TOKEN)"
  CLOUD_SECRET="$(prev CLOUD_API_APP_SECRET)"
  case "$CLOUD_VERIFY" in '' | troque-*) CLOUD_VERIFY="$(gen_secret 16)" ;; esac
  if confirm "Vai usar a Cloud API oficial da Meta?" n; then
    info "App Secret: App Dashboard da Meta → Configurações do app → Básico."
    info "Com ele o gateway valida a assinatura de todo webhook da Meta. Enter pula (dá para definir depois no .env)."
    ask_secret NEW_SECRET "App Secret da Meta"
    [ -n "$NEW_SECRET" ] && CLOUD_SECRET="$NEW_SECRET"
    [ -n "$CLOUD_SECRET" ] || warn "Sem App Secret, os webhooks da Meta são aceitos SEM validação. Defina CLOUD_API_APP_SECRET antes de produção."
  fi

  WEBHOOK_URL="$(prev WEBHOOK_GLOBAL_URL)"
  ask WEBHOOK_URL "Webhook global — URL que recebe os eventos de instâncias sem webhook próprio (Enter = nenhum)" "$WEBHOOK_URL"

  # Monta o .env a partir do exemplo (ou do atual, preservando ajustes manuais).
  NEW_ENV="$(mktemp)"
  if [ -n "$PREV" ]; then cp "$PREV" "$NEW_ENV"; else cp .env.example "$NEW_ENV"; fi

  set_env "$NEW_ENV" NODE_ENV production
  set_env "$NEW_ENV" LOG_LEVEL info
  set_env "$NEW_ENV" GLOBAL_API_KEY "$GLOBAL_KEY"
  set_env "$NEW_ENV" PUBLIC_BASE_URL "$PUBLIC_URL"
  set_env "$NEW_ENV" DB_PASSWORD "$DB_PASS"
  # Ainda não há migrations: é o synchronize que cria as tabelas no primeiro boot.
  set_env "$NEW_ENV" DB_SYNCHRONIZE true
  set_env "$NEW_ENV" RABBITMQ_PASS "$MQ_PASS"
  MQ_USER="$(get_env "$NEW_ENV" RABBITMQ_USER)"
  # Dentro do Compose o broker se chama `rabbitmq` (não localhost).
  set_env "$NEW_ENV" RABBITMQ_URI "amqp://${MQ_USER:-wamux}:${MQ_PASS}@rabbitmq:5672"
  set_env "$NEW_ENV" WHATSMEOW_MASTER_KEY "$WM_KEY"
  set_env "$NEW_ENV" WHATSMEOW_WEBHOOK_REQUIRE_SIGNATURE true
  set_env "$NEW_ENV" DATABASE_SAVE_DATA_CONTACTS "$SAVE_INBOX"
  set_env "$NEW_ENV" DATABASE_SAVE_DATA_NEW_MESSAGE "$SAVE_INBOX"
  set_env "$NEW_ENV" DATABASE_SAVE_MESSAGE_UPDATE "$SAVE_INBOX"
  set_env "$NEW_ENV" DATABASE_SAVE_MEDIA_BODY "$SAVE_INBOX"
  set_env "$NEW_ENV" ACTIVITY_LOG_ENABLED "$SAVE_LOGS"
  [ "$SAVE_LOGS" = true ] && [ "$(get_env "$NEW_ENV" ACTIVITY_LOG_RETENTION_DAYS)" = "0" ] &&
    set_env "$NEW_ENV" ACTIVITY_LOG_RETENTION_DAYS 30
  set_env "$NEW_ENV" CLOUD_API_VERIFY_TOKEN "$CLOUD_VERIFY"
  set_env "$NEW_ENV" CLOUD_API_APP_SECRET "$CLOUD_SECRET"
  if [ -n "$WEBHOOK_URL" ]; then
    set_env "$NEW_ENV" WEBHOOK_GLOBAL_ENABLED true
    set_env "$NEW_ENV" WEBHOOK_GLOBAL_URL "$WEBHOOK_URL"
  else
    set_env "$NEW_ENV" WEBHOOK_GLOBAL_ENABLED false
    set_env "$NEW_ENV" WEBHOOK_GLOBAL_URL ''
  fi

  cat "$NEW_ENV" >.env
  rm -f "$NEW_ENV"
  chmod 600 .env
  ok ".env gravado (permissão 600 — só o seu usuário lê)."
fi

docker compose config --quiet 2>/dev/null || die "O docker-compose.yml não validou com este .env. Rode 'docker compose config' em $INSTALL_DIR para ver o erro."

if [ "$NO_START" -eq 1 ]; then
  step "Pronto para subir"
  info "Você pediu --no-start. Para subir depois:"
  printf '    cd %s && docker compose up -d --build\n' "$INSTALL_DIR"
  exit 0
fi

# ── 4. portas ────────────────────────────────────────────────

step "Conferindo as portas"

RUNNING="$(docker compose ps --quiet 2>/dev/null | wc -l | tr -d ' ')"
if [ "$RUNNING" -gt 0 ]; then
  ok "A stack já está no ar ($RUNNING container(s)) — as portas são dela."
else
  BUSY=''
  for entry in "3000:API" "8080:painel" "8081:sidecar whatsmeow" "5432:Postgres" "6379:Redis" "5672:RabbitMQ" "15672:RabbitMQ (gestão)"; do
    port="${entry%%:*}"
    if port_in_use "$port"; then
      BUSY="$BUSY $port"
      warn "Porta $port (${entry#*:}) já está em uso."
    fi
  done
  if [ -n "$BUSY" ]; then
    info "Libere as portas acima ou ajuste o mapeamento em docker-compose.yml — senão o container correspondente não sobe."
    confirm "Tentar subir mesmo assim?" n || die "Instalação interrompida. O .env foi mantido em $INSTALL_DIR."
  else
    ok "Portas livres"
  fi
fi

# ── 5. subir ─────────────────────────────────────────────────

step "Subindo a stack"
info "A primeira vez constrói três imagens — costuma levar de 5 a 15 minutos."
confirm "Subir agora?" s || {
  info "Tudo configurado. Quando quiser: cd $INSTALL_DIR && docker compose up -d --build"
  exit 0
}

docker compose up -d --build || die "O 'docker compose up' falhou. Veja o erro acima; os logs ficam em: docker compose logs"

if has curl; then
  printf '  Aguardando a API responder'
  HEALTHY=0
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null; then
      HEALTHY=1
      break
    fi
    printf '.'
    sleep 3
  done
  printf '\n'
  if [ "$HEALTHY" -eq 1 ]; then
    ok "API saudável"
  else
    warn "A API ainda não respondeu em 3 minutos. Pode só estar terminando de subir — acompanhe com: docker compose logs -f gateway"
  fi
fi

# ── 6. resumo ────────────────────────────────────────────────

PUBLIC_URL="$(get_env .env PUBLIC_BASE_URL)"
GLOBAL_KEY="$(get_env .env GLOBAL_API_KEY)"

printf '\n%s%sWAMux instalado.%s\n\n' "$BOLD" "$GREEN" "$RESET"
printf '  Painel        http://localhost:8080\n'
printf '  API           http://localhost:3000/api/v1\n'
printf '  Documentação  http://localhost:3000/api/docs\n'
[ "$PUBLIC_URL" != "http://localhost:3000" ] && printf '  URL pública   %s\n' "$PUBLIC_URL"
printf '\n  %sChave de administração (GLOBAL_API_KEY):%s\n    %s\n' "$BOLD" "$RESET" "$GLOBAL_KEY"
info "Use-a para entrar no painel e no header 'apikey'. Ela também está em $INSTALL_DIR/.env"
printf '\n  Comandos úteis (dentro de %s):\n' "$INSTALL_DIR"
printf '    docker compose logs -f gateway     acompanhar os logs\n'
printf '    docker compose ps                  estado dos serviços\n'
printf '    docker compose down                parar (os dados ficam nos volumes)\n'
printf '    ./install.sh                       reconfigurar ou atualizar\n'
if [ "${PUBLIC_URL#https://}" = "$PUBLIC_URL" ] && [ "$PUBLIC_URL" != "http://localhost:3000" ]; then
  printf '\n'
  warn "A URL pública não usa HTTPS. A Meta só entrega webhooks e Flows em HTTPS — coloque um proxy com TLS na frente."
fi
case "$PUBLIC_URL" in
  http://localhost* | http://127.*) ;;
  *) info "As portas 5432, 6379, 5672 e 15672 ficam abertas no host: bloqueie-as no firewall em servidores públicos." ;;
esac
