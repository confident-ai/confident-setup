#!/bin/sh
set -eu
curl -fsSL "https://www.confident-ai.com/wizard/setup.sh" | sh -s -- --from deepeval "$@"
