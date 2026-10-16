# Deployment via Docker:

Run it:
```bash 
docker compose up
```

This needs a `.env` that should look like this:
```env
ADMIN_PASSWORD=... 
```

DB_PATH and PORT are already set in docker-compose.yml

Containers:
- `api`: The expressjs api server
- `reverse-proxy`: Servering the frontend + tunneling to the api

## Env Variables
- `PORT`
- `ADMIN_PASSWORD`
- `DB_PATH`