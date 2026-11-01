#!/usr/bin/env bash
# Builds and ships mvxvest.io to the websites droplet (adapted from mvxsafe.io's).
#
#   ./deploy.sh devnet     # devnet build   -> https://devnet.mvxvest.io
#   ./deploy.sh mainnet    # mainnet build  -> https://mvxvest.io (ask Sebastian first)
#
# The network is always named: a bare ./deploy.sh used to mean mainnet.
# What it refuses is proven by scripts/ci/audit5_ops_deploy_gates.mjs, which runs
# this script in a throwaway clone with rsync, ssh and curl stood in for.
#
# The droplet serves about ten other sites from the same nginx. This script only
# writes /var/www/mvxvest.io or /var/www/devnet.mvxvest.io and never touches the
# nginx config (scripts/server/nginx-mvxvest.io.conf). The key images live in
# public/nft/, so they are part of every build and survive rsync --delete.
set -euo pipefail

NETWORK="${1:-}"
REMOTE="web@134.209.228.52"
REMOTE_DIR="/var/www/mvxvest.io"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$NETWORK" in
  mainnet|devnet|testnet) ;;
  *) echo "Name the network: ./deploy.sh devnet | mainnet | testnet"; exit 1 ;;
esac

cd "$HERE"

# Mainnet has no contract yet: refuse rather than publish a site that points nowhere.
# (The address may sit on the line after "contractAddress =".)
if [ "$NETWORK" = mainnet ] && ! tr -d ' \n' < src/config/config.mainnet.ts | grep -Eq "contractAddress='erd1[02-9ac-hj-np-z]{58}'"; then
  echo "REFUSING: no mainnet contract address in src/config/config.mainnet.ts."; exit 1
fi

# What goes live must be what is on GitHub, on every network (the guide's
# pictures come from devnet, and both sites show their commit): no changed or
# untracked file in dapp/ (Vite copies all of public/ into the build), and a
# commit that origin/main already contains.
[ -z "$(git status --porcelain --untracked-files=all -- .)" ] || { echo "REFUSING: uncommitted changes. Commit and push first."; git status --short -- .; exit 1; }
git fetch -q origin main
git merge-base --is-ancestor HEAD origin/main ||
  { echo "REFUSING: $(git rev-parse --short HEAD) is not on origin/main. Push it first."; exit 1; }
# Any older commit of main passed the check above, so a laptop that did not pull
# rolled the site back. The tip of origin/main is what a deploy means; an older
# commit only on purpose (fifth audit, OPZ-01 and VSD-07; mvxsafe's OPX-02).
[ "${OLD_COMMIT:-}" = 1 ] || [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  { echo "REFUSING: $(git rev-parse --short HEAD) is behind origin/main ($(git rev-parse --short origin/main)). Pull first, or OLD_COMMIT=1 to ship an older commit on purpose."; exit 1; }
# git status does not list what .gitignore hides. Vite copies all of public/ as
# it is, so a *.pem there shipped under a clean commit's name (OPZ-01), and it
# reads .env.production.local, whose NODE_ENV turns the build into a development
# build (OPZ-07). Nothing git ignores may sit here but what is known to be
# generated. The list is per directory, so node_modules is one line.
stray="$(git ls-files --others --ignored --exclude-standard --directory | grep -vE '^(node_modules|build|coverage)/?$|^src/config/index\.ts$' || true)"
[ -z "$stray" ] || { echo "REFUSING: files git ignores would ship or change the build:"; echo "$stray" | sed 's/^/  /'; exit 1; }
# Nor is git status told about a tracked file flagged skip-worktree or
# assume-unchanged, which then ships changed (OPZ-01).
flagged="$(git ls-files -v | grep -E '^[a-zS] ' || true)"
[ -z "$flagged" ] || { echo "REFUSING: files hidden from git status (skip-worktree or assume-unchanged):"; echo "$flagged" | sed 's/^/  /'; exit 1; }

# Exactly the locked dependencies, and nothing ships that fails its tests, run
# against the network's own config.
pnpm install --frozen-lockfile
# No high advisory with a fix in what ships; pnpm-workspace.yaml lists the
# overrides (OPZ-01).
pnpm audit --prod --audit-level=high ||
  { echo "REFUSING: pnpm audit found a high advisory in what ships."; exit 1; }

# The site must know the code its network runs, or every visitor gets the red
# banner. CI checks the same, but a maintainer's merge can skip CI (fifth audit,
# OPS-6). During an upgrade the config lists both hashes, so the old one still
# passes here and the new one will. A read that fails refuses.
if [ "$NETWORK" != testnet ]; then
  case "$NETWORK" in
    mainnet) API="https://api.multiversx.com" ;;
    *)       API="https://devnet-api.multiversx.com" ;;
  esac
  CONFIG="src/config/config.$NETWORK.ts"
  CONTRACT="$(tr -d ' \n' < "$CONFIG" | grep -oE "contractAddress='erd1[02-9ac-hj-np-z]{58}'" | cut -d"'" -f2 || true)"
  [ -n "$CONTRACT" ] || { echo "REFUSING: no contract address in $CONFIG."; exit 1; }
  CODE_HASH="$(curl -fsS --max-time 30 --retry 2 "$API/accounts/$CONTRACT?fields=codeHash")" ||
    { echo "REFUSING: could not read the code hash of $CONTRACT from $API."; exit 1; }
  python3 - "$CONFIG" "$CODE_HASH" <<'PY'
import base64, json, re, sys
config, answer = open(sys.argv[1]).read(), sys.argv[2]
listed = re.search(r'contractCodeHashes = \[([^\]]*)\]', config)
# A hash commented out inside the array is not listed.
known = re.findall(r'[0-9a-f]{64}', re.sub(r'//[^\n]*|/\*.*?\*/', '', listed.group(1), flags=re.S)) if listed else []
try:
    live = base64.b64decode(json.loads(answer)['codeHash'], validate=True).hex()
except (ValueError, KeyError, TypeError):
    sys.exit(f'REFUSING: could not read the code hash from the answer: {answer[:200]}')
if live not in known:
    sys.exit(f'REFUSING: the network runs {live}, which is not in contractCodeHashes of {sys.argv[1]}: {known}')
print(f'The network runs {live}, listed in {sys.argv[1]}.')
PY
fi

pnpm -s "copy-$NETWORK-config"
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
# A production React carries its error decoder; NODE_ENV=development in the shell
# leaves no file for the gates above to see (OPZ-07).
grep -q 'Minified React error' build/assets/index-*.js ||
  { echo "REFUSING: build/ is a development build (NODE_ENV=${NODE_ENV:-unset} in the shell?)."; exit 1; }

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
# Every file lands under a temporary name and all are switched in together at
# the end, the old ones deleted after: deleting first removed the old bundle
# while the old index.html still named it, a blank page for whoever loaded the
# site during the upload (OPZ-01).
rsync -a --delete --delay-updates --delete-delay build/ "$REMOTE:$DIR/"

# If the site is ever behind a password again (it was during the private
# beta, 12 to 13 Oct 2026), pass it as MVXVEST_BETA_AUTH=user:password.
AUTH=()
[ -n "${MVXVEST_BETA_AUTH:-}" ] && AUTH=(-u "$MVXVEST_BETA_AUTH")
code=$(curl -s "${AUTH[@]}" -o /dev/null -w '%{http_code}' "$URL")
echo "$URL -> HTTP $code"
[ "$code" = "200" ] || { echo "The site did not answer 200 (behind a password? set MVXVEST_BETA_AUTH)."; exit 1; }

# A 200 says nothing about WHICH build answered; the version file does.
live="$(curl -s "${AUTH[@]}" "${URL}version.txt")"
[ "$live" = "$(cat build/version.txt)" ] ||
  { echo "The live site does not serve this build: version.txt says '$live'."; exit 1; }
echo "Live: ${COMMIT:0:7} on $NETWORK."

