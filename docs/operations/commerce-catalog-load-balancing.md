# Commerce Catalog Load Balancing

Production runs the commerce catalog API as one systemd instance per port:

```text
ocp-commerce-catalog@4000.service
...
ocp-commerce-catalog@4015.service
```

Nginx balances traffic across `127.0.0.1:4000` through `127.0.0.1:4015`.

`CATALOG_API_PORT` must not be present in the shared production `.env`. Bun auto-loads `.env` and would override the systemd instance port. The systemd template intentionally fails startup when the shared `.env` contains that key.

Use public `/health` only as an edge check. To verify the whole process pool, check every local backend:

```bash
for port in $(seq 4000 4015); do
  curl -fsS "http://127.0.0.1:${port}/health" >/dev/null
  echo "ok ${port}"
done
```

