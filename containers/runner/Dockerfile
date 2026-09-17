FROM node:24-bookworm-slim

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

RUN corepack enable
RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /workspace
CMD ["sh"]
