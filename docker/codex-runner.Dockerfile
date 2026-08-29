FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ARG CODEX_VERSION=0.150.0-alpha.8
RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
    && npm cache clean --force \
    && mkdir -p /home/node/.codex /contracts /workspace /run/secrets /opt/evidence-maintainer \
    && chown -R node:node /home/node/.codex /contracts /workspace /run/secrets /opt/evidence-maintainer

COPY --chown=node:node docker/credential-proxy.mjs /opt/evidence-maintainer/credential-proxy.mjs
COPY --chown=node:node docker/credential-proxy-core.mjs /opt/evidence-maintainer/credential-proxy-core.mjs

USER node
WORKDIR /workspace
ENTRYPOINT ["codex"]
