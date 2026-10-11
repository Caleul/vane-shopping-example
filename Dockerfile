# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node vendor/ ./vendor/
# Optional corporate/session CA, mounted only during dependency installation.
RUN --mount=type=secret,id=proxy_ca \
    if [ -s /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --ignore-scripts --strict-ssl=true
COPY --chown=node:node src/ ./src/
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node test/ ./test/
COPY --chown=node:node tsconfig.json ./
RUN mkdir -p /app/dist && chown node:node /app /app/dist \
    && find /app/src /app/scripts /app/test /app/vendor -type d -exec chmod 755 {} + \
    && find /app/src /app/scripts /app/test /app/vendor -type f -exec chmod 644 {} + \
    && chmod 644 /app/package.json /app/package-lock.json /app/tsconfig.json
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node src/server.mjs"]
