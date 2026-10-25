# Chat worker (human handoff)

Chesky answers common questions from the stored knowledge base in the browser. When he can't help, the
visitor leaves an email and this Worker takes over:

- stores the conversation (Cloudflare KV),
- emails the team a notification with a link to `/admin/`,
- emails the visitor a confirmation with a link back into the chat,
- shows the team's reply in the visitor's chat (it polls every few seconds while open) **and** emails it to them.

The team answers from `https://everythingshul.com/admin/` (password protected).
Replying to the notification email goes to the visitor's inbox only. To keep the conversation in the
chat, reply in the admin page.

## Teaching Chesky

Chesky also learns, but only what the team approves:

- Visitors can give a thumbs up or down on his answers. Questions he couldn't answer and thumbs-downs are
  logged anonymously (emails and phone numbers are scrubbed; names are never sent).
- In `/admin/` open **Teach Chesky**: write an answer once (plus other ways people ask it) and he uses it for
  similar questions from then on. You can edit or forget anything he has learned.
- When you reply to a chat, tick **Also teach Chesky this answer** to save your reply (edited, without names)
  for next time.
- Taught answers take priority over his built-in ones, so you can also fix an answer people don't like.
- Only replies sent from the admin page are seen by the system. Replying from Gmail directly won't teach him.

## Easiest way to set it up

`tools/deploy-workers.sh` deploys both Workers (contact form and chat), creates the storage, and points the
site at them. It needs only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The Brevo key and the admin
password are typed straight into Cloudflare, never into a script or chat: Workers & Pages -> the Worker ->
Settings -> Variables and Secrets -> Add (type Secret). Contact Worker: `BREVO_API_KEY`. Chat Worker:
`BREVO_API_KEY` and `ADMIN_TOKEN`.

## One-time setup by hand (about 10 minutes)

1. In Brevo, authenticate the domain `mail.everythingshul.com` and use `support@mail.everythingshul.com` as the sender (already set in `wrangler.toml`).
2. From this folder:
   ```
   npx wrangler login
   npx wrangler kv namespace create CHAT
   ```
   Paste the printed `id` into `wrangler.toml` (replace `PASTE_KV_NAMESPACE_ID_HERE`).
3. Add the two secrets (you'll be prompted to paste each):
   ```
   npx wrangler secret put BREVO_API_KEY
   npx wrangler secret put ADMIN_TOKEN      # a long random password: this is the /admin/ login
   ```
4. Deploy:
   ```
   npx wrangler deploy
   ```
   It prints `https://everythingshul-chat.<account>.workers.dev`.
5. Put that address in `js/chat-config.js` (`window.ES_CHAT_ENDPOINT = '...'`), commit and push.
6. Open `https://everythingshul.com/admin/`, sign in with the `ADMIN_TOKEN`, and bookmark it.

Until step 5 is done the chat still works: "Connect me with the team" opens the visitor's email app.

## Safeguards

- Only requests from `ALLOWED_ORIGINS` are answered; admin routes also need the `ADMIN_TOKEN`.
- Per-IP limits (6 handoffs / 60 messages per hour), message length caps, and a 30-second throttle on
  team notification emails during a fast back-and-forth.
- Conversations are deleted after 180 days; you can also delete one from the admin page.
- The anonymous question log keeps at most 300 questions; taught answers at most 400.
- The conversation id is the visitor's key to their own chat, so it is long and random.
