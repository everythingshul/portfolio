// Sends one email through Brevo (sender comes from the Worker's SENDER_EMAIL / SENDER_NAME).
export async function brevo(env, payload) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: env.SENDER_NAME, email: env.SENDER_EMAIL }, ...payload }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
}
