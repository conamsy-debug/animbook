# AnimBook Mobile web export — production image.
#
# AnimBook ships the mobile shell as a static web export via Expo.
# This image is the production shell. For the native tvOS bundle, see
# apps/mobile/BUILDING.md (Mac only).
#
# Build:    docker build -f apps/mobile/Dockerfile -t animbook-mobile:latest .
# Run:      docker run --rm -p 3005:80 animbook-mobile:latest

FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html

# Pre-built Expo web export is committed to apps/mobile/dist during the
# `npm run export:web` step. If you don't have it, run:
#   cd apps/mobile && npx expo export --platform web
COPY apps/mobile/dist/ ./

COPY <<EOF /etc/nginx/conf.d/default.conf
server {
  listen 80 default_server;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files \$uri \$uri/ /index.html;
  }
  location ~* \.(?:js|css|woff2?)$|images|assets {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000";
  }
  location = /healthz { return 200 "ok"; access_log off; }
}
EOF

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/healthz || exit 1

EXPOSE 80
