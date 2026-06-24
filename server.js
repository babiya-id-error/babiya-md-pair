const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Frontend folder

app.post('/pair', async (req, res) => {
    let phoneNumber = req.body.phone;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required!" });

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, `session_${phoneNumber}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        let isCodeSent = false; // Pairing code එක එකපාරක් විතරක් යවන්න සෙට් කරන බූලියන් එකක්

        // Socket එක රන් කරන්න වෙනම ෆන්ක්ෂන් එකක් හැදුවා Reconnect කරන්න ලේසි වෙන්න
        async function startWhatsAppConnection() {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: ["Mac OS", "Safari", "14.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

            // Pairing Code එක ජෙනරේට් කරලා API Response එක විදිහට යැවීම
            if (!sock.authState.creds.me && !isCodeSent) {
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        if (!res.headersSent) {
                            res.json({ code: code });
                            isCodeSent = true;
                        }
                    } catch (err) {
                        console.error("Pairing Code Generation Error:", err);
                        if (!res.headersSent) {
                            res.status(500).json({ error: "Failed to generate pairing code." });
                        }
                    }
                }, 3000); // තත්පර 3ක ඩිලේ එකක් දුන්නා සොකට් එක රෙඩි වෙනකන්
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                // 1. සාර්ථකව කනෙක්ට් වුණොත් (Open)
                if (connection === 'open') {
                    console.log(`[SUCCESS] Connected to ${phoneNumber}`);
                    
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf8');
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const sessionID = `BABIYA-MD;;;${base64Session}`;

                        const successMsg = `*👑 BABIYA-MD SESSION GENERATED 👑*\n\n*⚠️ DO NOT SHARE THIS WITH ANYONE!*\n\n*Session ID:*\n\`\`\`${sessionID}\`\`\``;
                        
                        // තමන්ගේ නම්බර් එකට මැසේජ් එක යවනවා
                        await sock.sendMessage(sock.user.id, { text: successMsg });
                        console.log("[INFO] Session ID sent successfully!");

                        // සෙෂන් එක යවලා ඉවර වෙලා සොකට් එක වහලා, තාවකාලික ෆයිල් මකනවා (සර්වර් එක ක්‍රැෂ් කරන්නේ නෑ)
                        setTimeout(() => {
                            try {
                                sock.ws.close(); 
                                fs.removeSync(sessionDir);
                                console.log(`[CLEANUP] Deleted temporary session directory for ${phoneNumber}`);
                            } catch (e) {
                                console.log("[CLEANUP ERROR]:", e.message);
                            }
                        }, 5000);
                    }
                }

                // 2. මැදදී කනෙක්ෂන් එක කැඩුනොත් (Close) -> මේක තමයි උඹට අඩු වෙලා තිබ්බේ!
                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    
                    console.log(`[CONNECTION CLOSED] Reason Code: ${reason}. Reconnecting: ${shouldReconnect}`);
                    
                    // ලොග් අවුට් වුණේ නැත්නම්, කනෙක්ෂන් එක බිඳ වැටුනොත් ආයේ ඔටෝ රීකනෙක්ට් වෙන්න කියනවා
                    if (shouldReconnect) {
                        startWhatsAppConnection();
                    } else {
                        // වැරදි කෝඩ් එකක් ගහලා ලොග් අවුට් වුණොත් ෆෝල්ඩර් එක මකනවා
                        fs.removeSync(sessionDir);
                    }
                }
            });
        }

        // සොකට් එක ස්ටාර්ට් කරනවා
        startWhatsAppConnection();

    } catch (error) {
        console.error("Main Process Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
});

app.listen(PORT, () => {
    console.log(`[BABIYA-MD] Session Generator running on port ${PORT}`);
});
