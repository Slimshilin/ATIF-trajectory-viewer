# Analyzer image for the AFT bridge's Docker runtime (ANALYZER_RUNTIME=docker).
# Each analysis runs in a throwaway container with only the workspace mounted.
#
# Build:  docker build -t aft-analyzer -f bridge/analyzer.Dockerfile bridge
# Use:    ANALYZER_RUNTIME=docker ANALYZER_DOCKER_IMAGE=aft-analyzer npm run bridge
#
# API-key mode works out of the box (the bridge injects the key as an env var).
# Subscription mode in a container needs the CLI's credentials — either bake a
# pre-authenticated image, or run the bridge with ANALYZER_DOCKER_MOUNT_AUTH=1
# to mount ~/.codex and ~/.claude read-only into the container.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The two analyzer CLIs. Adjust package names/versions to what you use.
RUN npm install -g @anthropic-ai/claude-code @openai/codex || \
    echo "NOTE: adjust CLI package names if install fails"

WORKDIR /work
