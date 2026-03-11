'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

async function simulateWhatsAppMessage() {
  const response = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-whatsapp-verify-token': process.env.WHATSAPP_VERIFY_TOKEN || '',
    },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: {
                  display_phone_number: '+91 98765 43210',
                  phone_number_id: process.env.WHATSAPP_PHONE_ID || 'test-phone-id',
                },
                contacts: [
                  {
                    profile: { name: 'WhatsApp Prospect' },
                    wa_id: '919876543210',
                  },
                ],
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.test-message-1',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: {
                      body: 'My brother needs coaching from next month',
                    },
                    type: 'text',
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ status: response.status, payload }, null, 2));
}

if (require.main === module) {
  simulateWhatsAppMessage().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { simulateWhatsAppMessage };
