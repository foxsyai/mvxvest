#!/usr/bin/env bash
# Builds and ships mvxvest.io to the websites droplet (adapted from mvxsafe.io's).
#
#   ./deploy.sh devnet     # devnet build   -> https://devnet.mvxvest.io
#   ./deploy.sh            # mainnet build  -> https://mvxvest.io (ask Sebastian first)
#
# The droplet serves about ten other sites from the same nginx. This script only
# writes /var/www/mvxvest.io or /var/www/devnet.mvxvest.io and never touches the
# nginx config (scripts/server/nginx-mvxvest.io.conf). The key images live in
# public/nft/, so they are part of every build and survive rsync --delete.
set -euo pipefail

NETWORK="${1:-mainnet}"
REMOTE="web@134.209.228.52"
REMOTE_DIR="/var/www/mvxvest.io"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$NETWORK" in
  mainnet|devnet|testnet) ;;
  *) echo "Unknown network: $NETWORK (use mainnet, devnet or testnet)"; exit 1 ;;
esac

cd "$HERE"

# Mainnet has no contract yet: refuse rather than publish a site that points nowhere.
# (The address may sit on the line after "contractAddress =".)
if [ "$NETWORK" = mainnet ] && ! tr -d ' \n' < src/config/config.mainnet.ts | grep -Eq "contractAddress='erd1[02-9ac-hj-np-z]{58}'"; then
  echo "REFUSING: no mainnet contract address in src/config/config.mainnet.ts."; exit 1
fi

# What goes live on mainnet must be what is on GitHub: no uncommitted changes,
# and a commit that origin/main already contains.
if [ "$NETWORK" = mainnet ]; then
  git diff --quiet HEAD -- || { echo "REFUSING: uncommitted changes. Commit and push first."; exit 1; }
  git fetch -q origin main
  git merge-base --is-ancestor HEAD origin/main ||
    { echo "REFUSING: $(git rev-parse --short HEAD) is not on origin/main. Push it first."; exit 1; }
fi

# Exactly the locked dependencies, and nothing ships that fails its tests.
pnpm install --frozen-lockfile
pnpm -s exec jest --bail=0 --silent

echo "Building for $NETWORK..."
pnpm "build-$NETWORK"

# The bundle has to say, twice and independently, that it is what we are about
# to publish: the marker the build writes from its config, and the network that
# was actually compiled into the code. A "mainnet" build used to be able to
# carry devnet when its steps raced (ops audit OPS-01 and OPS-03, 7 Oct 2026).
COMMIT="$(git rev-parse HEAD)"
read -r built_commit built_network < build/version.txt || true
[ "${built_network:-}" = "$NETWORK" ] ||
  { echo "REFUSING: build/ says it is a '${built_network:-}' build, not $NETWORK."; exit 1; }
[ "${built_commit:-}" = "$COMMIT" ] ||
  { echo "REFUSING: build/ is commit '${built_commit:-}', not $COMMIT."; exit 1; }
compiled="$(grep -ohE 'environment=[A-Za-z0-9_$]+\.(mainnet|devnet|testnet)' build/assets/index-*.js | head -1)"
case "$compiled" in
  *".$NETWORK") echo "build/ is ${COMMIT:0:7}, compiled for $NETWORK." ;;
  *) echo "REFUSING: the code in build/ was compiled for '${compiled:-nothing recognisable}', not $NETWORK."; exit 1 ;;
esac

# devnet goes to its own host, which exists so the whole cycle can be tried with
# play money; testnet is built but not published anywhere.
case "$NETWORK" in
  mainnet) DIR="$REMOTE_DIR"; URL="https://mvxvest.io/" ;;
  devnet)  DIR="/var/www/devnet.mvxvest.io"; URL="https://devnet.mvxvest.io/" ;;
  *)
    echo
    echo "Built for $NETWORK. There is no host for it: the build is in ./build."
    exit 0
    ;;
esac

echo "Shipping to $REMOTE:$DIR ..."
rsync -a --delete build/ "$REMOTE:$DIR/"

# During the private beta mvxvest.io asks for a password: pass it as
# MVXVEST_BETA_AUTH=user:password to check the live build.
AUTH=()
[ -n "${MVXVEST_BETA_AUTH:-}" ] && AUTH=(-u "$MVXVEST_BETA_AUTH")
code=$(curl -s "${AUTH[@]}" -o /dev/null -w '%{http_code}' "$URL")
echo "$URL -> HTTP $code"
[ "$code" = "200" ] || { echo "The site did not answer 200 (behind the beta password? set MVXVEST_BETA_AUTH)."; exit 1; }

# A 200 says nothing about WHICH build answered; the version file does.
live="$(curl -s "${AUTH[@]}" "${URL}version.txt")"
[ "$live" = "$(cat build/version.txt)" ] ||
  { echo "The live site does not serve this build: version.txt says '$live'."; exit 1; }
echo "Live: ${COMMIT:0:7} on $NETWORK."

