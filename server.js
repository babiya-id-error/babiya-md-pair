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

// ==========================================
// 1. PAIRING CODE ENDPOINT
// ==========================================
app.post('/pair', async (req, res) => {
    let phoneNumber = req.body.phone;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required!" });

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, `session_${phoneNumber}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        let isCodeSent = false; 

        async function startWhatsAppConnection() {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: ["Mac OS", "Safari", "14.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

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
                }, 3000); 
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'open') {
                    console.log(`[SUCCESS] Connected to ${phoneNumber}. Waiting 10 seconds for encryption keys to settle...`);
                    
                    setTimeout(async () => {
                        const credsPath = path.join(sessionDir, 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            const credsData = fs.readFileSync(credsPath, 'utf8');
                            const base64Session = Buffer.from(credsData).toString('base64');
                            const sessionID = `BABIYA-MD;;;${base64Session}`;

                            const targetJid = `${phoneNumber}@s.whatsapp.net`;
                            const warningMsg = `*👑 BABIYA-MD SESSION GENERATED 👑*\n\n*⚠️ DO NOT SHARE THIS WITH ANYONE!*`;
                            
                            try {
                                await sock.sendMessage(targetJid, { text: warningMsg });
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                await sock.sendMessage(targetJid, { text: sessionID });
                                console.log("[INFO] Fully encrypted Messages sent successfully!");
                            } catch (msgErr) {
                                console.error("[ERROR] Failed to send messages:", msgErr);
                            }

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
                    }, 10000);
                }

                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    
                    if (shouldReconnect) {
                        startWhatsAppConnection();
                    } else {
                        fs.removeSync(sessionDir);
                    }
                }
            });
        }

        startWhatsAppConnection();

    } catch (error) {
        console.error("Main Process Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
});

// ==========================================
// 2. QR CODE ENDPOINT (NEW)
// ==========================================
app.get('/qr', async (req, res) => {
    // QR කනෙක්ෂන් එකට හැම පාරම වෙනමම random ID එකකින් තාවකාලික ෆෝල්ඩර් එකක් හැදෙනවා
    const uniqueId = Math.random().toString(36).substring(7);
    const sessionDir = path.join(__dirname, `session_qr_${uniqueId}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        let isQrSent = false;

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: ["Mac OS", "Safari", "14.0.0"]
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // WhatsApp සර්වර් එකෙන් QR ස්ට්‍රින්ග් එක ආපු ගමන් ඒක Frontend එකට Response එකක් විදිහට යවනවා
            if (qr && !isQrSent) {
                if (!res.headersSent) {
                    res.json({ qr: qr });
                    isQrSent = true;
                }
            }

            // කවුරුහරි වෙබ් එකේ තියෙන QR එක ෆෝන් එකෙන් ස්කෑන් කරලා සාර්ථකව සම්බන්ධ වුණොත්
            if (connection === 'open') {
                console.log(`[QR SUCCESS] Connected successfully via QR Code. Waiting 10 seconds for keys to settle...`);

                setTimeout(async () => {
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf8');
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const sessionID = `BABIYA-MD;;;${base64Session}`;

                        // QR වලින් ලොග් වෙද්දී නම්බර් එක කලින් දන්නේ නැති නිසා sock.user.id එකෙන් කෙලින්ම තමන්ගේ JID එක ක්ලීන් කරලා ගන්නවා
                        const targetJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                        const warningMsg = `*👑 BABIYA-MD SESSION GENERATED 👑*\n\n*⚠️ DO NOT SHARE THIS WITH ANYONE!*`;

                        try {
                            // පළවෙනි මැසේජ් එක (Warning)
                            await sock.sendMessage(targetJid, { text: warningMsg });
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // දෙවෙනි මැසේජ් එක (Fully Encrypted Session ID)
                            await sock.sendMessage(targetJid, { text: sessionID });
                            console.log("[INFO] Session ID sent successfully via QR Login!");
                        } catch (msgErr) {
                            console.error("[ERROR] Failed to send QR session message:", msgErr);
                        }

                        // වැඩේ ඉවර නිසා සොකට් එක වහලා තාවකාලික ෆෝල්ඩර් එක ඩිලීට් කරනවා
                        setTimeout(() => {
                            try {
                                sock.ws.close();
                                fs.removeSync(sessionDir);
                                console.log(`[CLEANUP] Deleted temporary QR session directory.`);
                            } catch (e) {}
                        }, 5000);
                    }
                }, 10000); // පර්ෆෙක්ට් මැසේජ් ඩිකෝඩින් කීස් ටික ලැබෙනකන් මෙතනත් තත්පර 10ක් රඳවා ගන්නවා
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = reason !== DisconnectReason.loggedOut;
                
                if (!shouldReconnect) {
                    fs.removeSync(sessionDir);
                }
            }
        });

    } catch (error) {
        console.error("QR Process Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
});

app.listen(PORT, () => {
    console.log(`[BABIYA-MD] Session Generator running on port ${PORT}`);
});
