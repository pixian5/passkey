FROM node:22-bookworm AS web-assets
WORKDIR /src/apps/codex-tauri
COPY apps/codex-tauri/package.json apps/codex-tauri/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/codex-tauri/index.html ./index.html
COPY apps/codex-tauri/src ./src
COPY apps/codex-tauri/scripts ./scripts
# The shared web build synchronizes the same merge/CSV/mutation modules into
# the Chrome Web surface. Keep this copy in the asset stage; the Rust stage
# already copies the complete core tree independently.
COPY core/pass_core/js /src/core/pass_core/js
RUN npm run prepare:dist

FROM rust:1.86-bookworm AS rust-build
WORKDIR /src
COPY core/pass_core /src/core/pass_core
COPY apps/pass-web /src/apps/pass-web
COPY --from=web-assets /src/apps/codex-tauri/dist /src/apps/codex-tauri/dist
RUN cargo build --manifest-path apps/pass-web/Cargo.toml --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin passweb \
    && mkdir -p /data /opt/pass-web/dist \
    && chown -R passweb:passweb /data /opt/pass-web
COPY --from=rust-build /src/apps/pass-web/target/release/pass-web /usr/local/bin/pass-web
COPY --from=rust-build /src/apps/codex-tauri/dist /opt/pass-web/dist
ENV PASS_WEB_HOST=0.0.0.0 \
    PASS_WEB_PORT=53335 \
    PASS_WEB_DATA_DIR=/data \
    PASS_WEB_STATIC_DIR=/opt/pass-web/dist
VOLUME ["/data"]
EXPOSE 53335
USER passweb
ENTRYPOINT ["/usr/local/bin/pass-web"]
