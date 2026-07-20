export EMPLOYED_DIR="$(mktemp -d)"
employed init --no-animation
rm -rf "$EMPLOYED_DIR"
unset EMPLOYED_DIR
