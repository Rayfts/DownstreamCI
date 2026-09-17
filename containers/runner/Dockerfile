FROM node:24-bookworm-slim

ARG PNPM_VERSION=10.17.1
ARG YARN_VERSION=1.22.22
ARG UV_VERSION=0.12.15
ARG POETRY_VERSION=2.4.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      cargo \
      git \
      golang-go \
      pkg-config \
      python-is-python3 \
      python3 \
      python3-build \
      python3-pip \
      python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/downstreamci-tools \
    && /opt/downstreamci-tools/bin/pip install --no-cache-dir "uv==${UV_VERSION}" "poetry==${POETRY_VERSION}"
ENV PATH="/opt/downstreamci-tools/bin:${PATH}"

RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && corepack prepare "yarn@${YARN_VERSION}" --activate

RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /workspace
CMD ["sh"]
