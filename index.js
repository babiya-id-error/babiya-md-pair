const express = require('express');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Pairing API Endpoint
app.get('/code', async (req, res) => {
    let phone = req.query.number;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });
    
    phone = phone.replace(/[^0-9]/g, '');

    // තාවකාලික සෙෂන් ෆෝල්ඩර් එකක් (Random ID එකකින්)
    const sessionDir = `./session_${Date.now()}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    try {
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        sock.ev.on('creds.update', saveCreds);

        // Connection Update Handler
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;

            if (connection === 'open') {
                await delay(5000); // creds.json එක සම්පූර්ණයෙන්ම සේව් වෙනකන් පොඩි ඩිලේ එකක්

                // creds.json කියවලා Base64 කරන්න
                const credsPath = path.join(sessionDir, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf8');
                    const base64Session = Buffer.from(credsData).toString('base64');
                    const sessionId = `BABIYA-MD;;;${base64Session}`;

                    const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                    // 1. පළවෙනි මැසේජ් එක - විස්තර සටහන
                    await sock.sendMessage(myJid, { 
                        text: `👑 *BABIYA-MD SESSION CONNECTED* 👑\n\n⚠️ *මෙම කෝඩ් එක කා සමඟවත් බෙදා නොගන්න!*` 
                    });

                    // 2. දෙවෙනි මැසේජ් එක - Session ID එක විතරක් (කොපි කරගන්න ලේසි වෙන්න) 🔥
                    await sock.sendMessage(myJid, { text: sessionId });
                }

                // ආරක්ෂාව වෙනුවෙන් වැඩේ ඉවර වුණු ගමන් සර්වර් එකේ තියෙන තාවකාලික ෆයිල් wipe කරනවා
                try {
                    sock.logout();
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                } catch (e) {}
            }
        });

        // Pairing Code එක රික්වෙස්ට් කරලා වෙබ් එකට යැවීම
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phone);
                res.json({ code: code });
            } catch (err) {
                res.status(500).json({ error: 'Failed to generate pairing code' });
            }
        }, 3000);

    } catch (error) {
        res.status(500).json({ error: 'Server Error' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
