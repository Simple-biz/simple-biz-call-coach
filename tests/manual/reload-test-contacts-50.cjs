const TOKEN = 'a1f0f3acb665a535ff509f1d6ab9f9eb6b13abf2';
const BUCKET_ID = 3470;
const PHONE = '+17754068577';
const BASE = 'https://west-3.calltools.io/api';
const COUNT = 50;

async function createContact(i) {
  const suffix = Date.now().toString().slice(-4);
  const contactResp = await fetch(BASE + '/contacts/', {
    method: 'POST',
    headers: { 'Authorization': 'Token ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: 'Auto Dial', last_name: 'Test ' + i + '-' + suffix, buckets: [BUCKET_ID] })
  });
  const contact = await contactResp.json();

  const phoneResp = await fetch(BASE + '/phonenumbers/', {
    method: 'POST',
    headers: { 'Authorization': 'Token ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact: contact.id, phone_number: PHONE })
  });
  const phone = await phoneResp.json();
  return { i, contactId: contact.id, phone: phone.phone_number };
}

async function main() {
  console.log(`Adding ${COUNT} contacts with ${PHONE} to Test Bucket (${BUCKET_ID})...`);

  for (let i = 1; i <= COUNT; i++) {
    try {
      const result = await createContact(i);
      console.log(`[${i}/${COUNT}] Contact ${result.contactId} — ${result.phone}`);
    } catch (e) {
      console.error(`[${i}/${COUNT}] Failed:`, e.message);
    }
  }

  console.log(`Done. ${COUNT} contacts loaded.`);
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
