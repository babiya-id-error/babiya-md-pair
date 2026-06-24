const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Frontend එක තියෙන ෆෝල්ඩර් එක

app.post('/pair', async (req, res) => {
    let phoneNumber = req.body.phone;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required!" });

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, `session_${phoneNumber}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        sock.ev.on('creds.update', saveCreds);

        // Pairing Code එක ජෙනරේට් කරලා සයිට් එකට යවනවා
        if (!sock.authState.creds.me) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    res.json({ code: code });
                } catch (err) {
                    res.status(500).json({ error: "Failed to generate pairing code." });
                }
            }, 2000);
        }

        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
                console.log(`[SUCCESS] Connected to ${phoneNumber}`);
                
                // Session ID එක හැදීම (creds.json එක Base64 කිරීම)
                const credsPath = path.join(sessionDir, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf8');
                    const base64Session = Buffer.from(credsData).toString('base64');
                    const sessionID = `BABIYA-MD;;;${base64Session}`;

                    // Session ID එක තමන්ගෙම නම්බර් එකට යැවීම
                    const successMsg = `*👑 BABIYA-MD SESSION GENERATED 👑*\n\n*⚠️ DO NOT SHARE THIS WITH ANYONE!*\n\n*Session ID:*\n\`\`\`${sessionID}\`\`\``;
                    await sock.sendMessage(sock.user.id, { text: successMsg });

                    console.log("[INFO] Session ID sent! Cleaning up...");
                    
                    // තාවකාලික සෙෂන් ෆෝල්ඩර් එක මකා දැමීම
                    setTimeout(() => {
                        fs.removeSync(sessionDir);
                        process.exit(0); // Restart server for next user
                    }, 5000);
                }
            }
        });

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, () => {
    console.log(`[BABIYA-MD] Session Generator running on http://localhost:${PORT}`);
});
