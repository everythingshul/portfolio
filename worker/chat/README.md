# Chat worker

Answers the website chat widget (Chesky) with Claude. The widget works without this (it falls back to
built-in answers); deploying it upgrades the answers to natural language.

## One-time setup

1. Get an Anthropic API key (console.anthropic.com -> API keys).
2. From this folder:
   ```
   npm install
   npx wrangler login
   npx wrangler secret put ANTHROPIC_API_KEY    # paste the key when prompted
   npx wrangler deploy
   ```
3. Put the printed `https://everythingshul-chat.<account>.workers.dev` URL in `ENDPOINT` at the top
   of `js/chat.js` and push.

## Notes

- `knowledge.js` is generated from `tools/build.py` (the same project list the site uses). Re-run
  `python3 tools/build.py` after adding a project, then `npx wrangler deploy` again.
- Cost: each chat message is one short API call. `MODEL` in `wrangler.toml` defaults to
  `claude-opus-5-5`; set it to `claude-haiku-5-5` to make answers several times cheaper.
- Only requests from `ALLOWED_ORIGINS` are answered. For heavier abuse protection add a
  Cloudflare rate-limiting rule on this Worker's route.
