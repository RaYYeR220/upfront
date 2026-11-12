# Deploying Upfront

The API runs in one container next to the Kite Passport CLI, behind Caddy. The web app deploys separately (any Next.js host) and talks to the API over HTTPS.

```sh
cp .env.example .env    # fill it in
docker compose up -d --build
```

## The paying agent

Upfront pays for public records through a Kite Agent Passport. The Passport login lives in the `upfront-data` volume, so it survives restarts.

```sh
# 1. Log in (an 8-character code arrives by email)
docker compose exec -e HOME=/data/kite/house api kpass login init --email you@example.com --output json
docker compose exec -e HOME=/data/kite/house api kpass login verify --login-id <id> --code <code> --output json

# 2. Ask for a spending session the owner approves with a passkey
docker compose exec -e HOME=/data/kite/house api kpass session create --separate --output json --delegation '{
  "task": { "summary": "Buy French company records for credit checks" },
  "payment_policy": { "max_amount_per_tx": "0.20", "max_total_amount": "30", "ttl_seconds": 604800 },
  "execution_constraints": { "x402": { "scope_mode": "scoped",
    "allowed_endpoints": [ { "method": "GET", "host": "api.sirenic.eu", "path_prefix": "/v1/" } ] } }
}'
# open the approval link it prints, approve with your passkey, then:
docker compose exec -e HOME=/data/kite/house api kpass session status --request-id <id> --wait --output json
```

The session is the spending limit: no single lookup above $0.20, no more than $30 in total, only the company-records endpoints, for a week. Kite refuses anything outside it, and Upfront records each refusal on the check.

## Health

- `GET /api/health` and `GET /api/meta` on the API host.
- `docker compose logs -f api` shows each check and the daily watch run.
