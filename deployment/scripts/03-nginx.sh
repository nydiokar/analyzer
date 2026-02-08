#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-api.sova-intel.com}"
UPSTREAM="${UPSTREAM:-127.0.0.1:3001}"
ENABLE_TLS=false
HTTP_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --upstream) UPSTREAM="$2"; shift 2 ;;
    --enable-tls) ENABLE_TLS=true; shift ;;
    --http-only) HTTP_ONLY=true; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deployment/scripts/03-nginx.sh ..." >&2
  exit 1
fi

NGINX_CONF="/etc/nginx/nginx.conf"
SITE_AVAIL="/etc/nginx/sites-available/${DOMAIN}"
SITE_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
TS="$(date +%Y%m%d-%H%M%S)"

cp "$NGINX_CONF" "${NGINX_CONF}.bak.${TS}"
[ -f "$SITE_AVAIL" ] && cp "$SITE_AVAIL" "${SITE_AVAIL}.bak.${TS}"

if ! grep -q "limit_req_zone .*zone=api_limit:10m rate=3r/s;" "$NGINX_CONF"; then
  awk '
    BEGIN { inserted=0 }
    {
      print $0
      if (!inserted && $0 ~ /^http[[:space:]]*{/) {
        print ""
        print "    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=3r/s;"
        print ""
        inserted=1
      }
    }
  ' "$NGINX_CONF" > "${NGINX_CONF}.tmp"
  mv "${NGINX_CONF}.tmp" "$NGINX_CONF"
fi

if [ "$HTTP_ONLY" = true ] || [ "$ENABLE_TLS" = false ]; then
cat > "$SITE_AVAIL" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    limit_req_status 429;
    error_page 429 = @ratelimit;
    location @ratelimit {
        add_header Content-Type 'application/json; charset=utf-8';
        return 429 '{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded"}';
    }

    location / {
        proxy_pass http://${UPSTREAM};
        limit_req zone=api_limit burst=10 nodelay;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~* /socket.io/.* {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF
else
cat > "$SITE_AVAIL" <<EOF
server {
    server_name ${DOMAIN};

    limit_req_status 429;
    error_page 429 = @ratelimit;
    location @ratelimit {
        add_header Content-Type 'application/json; charset=utf-8';
        return 429 '{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded"}';
    }

    location / {
        proxy_pass http://${UPSTREAM};
        limit_req zone=api_limit burst=10 nodelay;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ~* /socket.io/.* {
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    listen [::]:443 ssl ipv6only=on;
    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if (\$host = ${DOMAIN}) {
        return 301 https://\$host\$request_uri;
    }
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 404;
}
EOF
fi

ln -sfn "$SITE_AVAIL" "$SITE_ENABLED"
nginx -t
systemctl reload nginx

echo "Nginx applied for ${DOMAIN} -> ${UPSTREAM}"
echo "Smoke check:"
curl -sS -i -H "Host: ${DOMAIN}" http://127.0.0.1/api/v1/health | sed -n '1,20p'

