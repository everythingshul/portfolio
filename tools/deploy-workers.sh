#!/usr/bin/env bash
# Deploys both Cloudflare Workers (contact form + chat) without any prompts, and points the site at them.
#
# Needs two environment variables (a Workers-only API token, safe to delete afterwards):
#   CLOUDFLARE_API_TOKEN   token made from the "Edit Cloudflare Workers" template
#   CLOUDFLARE_ACCOUNT_ID  shown in the Cloudflare dashboard sidebar
#
# It does NOT handle secrets. The owner types those straight into Cloudflare
# (Workers & Pages -> the Worker -> Settings -> Variables and Secrets -> Add, type "Secret"):
#   everythingshul-contact:  BREVO_API_KEY
#   everythingshul-chat:     BREVO_API_KEY and ADMIN_TOKEN  (ADMIN_TOKEN = the /admin/ password)
#
# Safe to re-run. Add --send-test you@example.com to send one real test email through Brevo afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
SITE="https://everythingshul.com"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
WR="npx --yes wrangler@4"
cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
pj() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

echo "1/5 Checking the Cloudflare token..."
cf "https://api.cloudflare.com/client/v4/user/tokens/verify" | pj "assert d.get('success'), 'The API token was not accepted'; print('   token ok')"

echo "2/5 workers.dev address..."
SUB=$(cf "$API/workers/subdomain" | pj "print(((d.get('result') or {}).get('subdomain')) or '')")
if [ -z "$SUB" ]; then
  SUB="${WORKERS_SUBDOMAIN:-everythingshul}"
  cf -X PUT "$API/workers/subdomain" -d "{\"subdomain\":\"$SUB\"}" | pj "assert d.get('success'), 'Could not register the workers.dev name \"$SUB\": ' + str(d.get('errors')) + ' (set WORKERS_SUBDOMAIN to another name and re-run)'"
  echo "   registered $SUB.workers.dev"
else
  echo "   using $SUB.workers.dev"
fi

echo "3/5 Chat storage (KV)..."
KV_ID=$(cf "$API/storage/kv/namespaces?per_page=100" | pj "print(next((n['id'] for n in d.get('result', []) if n['title']=='everythingshul-chat-CHAT'), ''))")
if [ -z "$KV_ID" ]; then
  KV_ID=$(cf -X POST "$API/storage/kv/namespaces" -d '{"title":"everythingshul-chat-CHAT"}' | pj "assert d.get('success'), d.get('errors'); print(d['result']['id'])")
  echo "   created namespace"
else
  echo "   found existing namespace"
fi
python3 - "$KV_ID" <<'PY'
import re, sys
p = 'worker/chat/wrangler.toml'
s = open(p).read()
s = re.sub(r'(binding = "CHAT"\nid = )"[^"]*"', r'\1"%s"' % sys.argv[1], s)
open(p, 'w').write(s)
PY

echo "3b/5 Analytics storage (D1)..."
# Needs the token to have "D1: Edit". Without it, analytics stays off and the rest still deploys.
D1_ID=$(cf "$API/d1/database?name=everythingshul-stats" | pj "
assert d.get('success'), 'D1 not allowed: ' + str(d.get('errors'))
print(next((x['uuid'] for x in d.get('result', []) if x['name']=='everythingshul-stats'), ''))" 2>/dev/null || echo "DENIED")
if [ "$D1_ID" = "DENIED" ]; then
  echo "   !! The token cannot use D1. Add the permission Account > D1 > Edit to the token and re-run."
  echo "   !! Skipping the chat Worker deploy so the placeholder database id does not break it."
  SKIP_CHAT=1
else
  if [ -z "$D1_ID" ]; then
    D1_ID=$(cf -X POST "$API/d1/database" -d '{"name":"everythingshul-stats"}' | pj "assert d.get('success'), d.get('errors'); print(d['result']['uuid'])")
    echo "   created database"
  else
    echo "   found existing database"
  fi
  python3 - "$D1_ID" <<'PY'
import re, sys
p = 'worker/chat/wrangler.toml'
s = open(p).read()
s = re.sub(r'(database_id = )"[^"]*"', r'\1"%s"' % sys.argv[1], s)
open(p, 'w').write(s)
PY
  (cd worker/chat && $WR d1 execute everythingshul-stats --remote --file=schema.sql 2>&1 | grep -E "Executed|error|Error" || true)
fi

echo "4/5 Deploying the Workers..."
for d in worker worker/chat; do
  if [ "$d" = "worker/chat" ] && [ "${SKIP_CHAT:-0}" = "1" ]; then echo "   -> $d skipped"; continue; fi
  echo "   -> $d"
  (cd "$d" && $WR deploy 2>&1 | grep -E "Deployed|https://|Error|error" || true)
done

CONTACT_URL="https://everythingshul-contact.$SUB.workers.dev"
CHAT_URL="https://everythingshul-chat.$SUB.workers.dev"

echo "5/5 Pointing the site at them..."
sed -i "s#^window.ES_CHAT_ENDPOINT = .*#window.ES_CHAT_ENDPOINT = '$CHAT_URL';#" js/chat-config.js
sed -i "s#const ENDPOINT = 'https://everythingshul-contact[^']*';#const ENDPOINT = '$CONTACT_URL';#" js/main.js
echo "   contact: $CONTACT_URL"
echo "   chat:    $CHAT_URL"

echo "Smoke tests (no email is sent)..."
code=$(curl -sS -o /tmp/es-learned.json -w "%{http_code}" -H "Origin: $SITE" "$CHAT_URL/learned" || true)
echo "   chat   GET /learned          -> $code (expect 200)"
code=$(curl -sS -o /dev/null -w "%{http_code}" -X POST -H "Origin: $SITE" -H "Content-Type: application/json" -d '{}' "$CONTACT_URL" || true)
echo "   contact POST with no fields  -> $code (expect 400)"
code=$(curl -sS -o /dev/null -w "%{http_code}" -H "Origin: https://example.org" "$CHAT_URL/learned" || true)
echo "   chat   from another website  -> $code (expect 403)"

if [ "${1:-}" = "--send-test" ] && [ -n "${2:-}" ]; then
  echo "Sending one real test email through Brevo to $2 (needs the BREVO_API_KEY secret to be set)..."
  code=$(curl -sS -o /tmp/es-test.json -w "%{http_code}" -X POST -H "Origin: $SITE" -H "Content-Type: application/json" \
    -d "{\"name\":\"Deploy test\",\"email\":\"$2\",\"org\":\"\",\"interest\":\"\",\"message\":\"This is a test message sent while setting up email.\"}" "$CONTACT_URL" || true)
  echo "   contact form -> $code (expect 200; check both inboxes)"; cat /tmp/es-test.json; echo
fi

cat <<MSG

Done. Still to do by the site owner, directly in Cloudflare (Workers & Pages -> Worker -> Settings -> Variables and Secrets):
  everythingshul-contact : secret BREVO_API_KEY
  everythingshul-chat    : secrets BREVO_API_KEY and ADMIN_TOKEN (choose a long password; it is the /admin/ login)
Then commit the changed files (worker/chat/wrangler.toml, js/chat-config.js, js/main.js) and merge to main.
MSG
