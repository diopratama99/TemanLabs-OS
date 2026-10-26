# The TemanLabsOS website: built with Astro, served by nginx.
#   docker build -t temanlabsos-site . && docker run -p 8080:80 temanlabsos-site
# SITE_URL (the site's public address) makes canonical links and social previews absolute.

FROM node:22-alpine AS build
WORKDIR /site
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ARG SITE_URL=
ENV SITE_URL=$SITE_URL
RUN npx astro build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY headers.inc /etc/nginx/conf.d/headers.inc
COPY --from=build /site/dist /usr/share/nginx/html
# The try-it demo (npm run build:demo): TemanLabsOS on sample data, at /demo/.
COPY demo-dist /usr/share/nginx/html/demo
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
