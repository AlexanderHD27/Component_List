# Deployment via Docker:

Run it:
```bash 
docker compose up
```

Containers:
- `api`: The expressjs api server
- `reverse-proxy`: Servering the frontend + tunneling to the api

## Env Variables
- `PORT`
- `ADMIN_PASSWORD`
- `DB_PATH`