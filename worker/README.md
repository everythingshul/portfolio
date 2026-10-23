# Contact form worker

Receives the contact form, then sends two Brevo emails: a notification to
`TO_EMAIL` and a confirmation to the visitor. Templates live in `emails.js`
(palette constants at the top).

## One-time setup

1. In Brevo: create an API key (SMTP & API -> API Keys) and verify the sender
   address used as `SENDER_EMAIL` in `wrangler.toml` (Senders, Domains & Dedicated IPs).
2. From this folder:
   ```
   npx wrangler login
   npx wrangler secret put BREVO_API_KEY    # paste the key when prompted
   npx wrangler deploy
   ```
3. Put the printed `https://everythingshul-contact.<account>.workers.dev` URL in
   `ENDPOINT` in `js/main.js` (if it differs) and push.

Until the worker is deployed the form falls back to opening the visitor's email app.
