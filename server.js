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
// 2. QR CODE ENDPOINT (FIXED)
// ==========================================
app.get('/qr', async (req, res) => {
    const uniqueId = Math.random().toString(36).substring(7);
    const sessionDir = path.join(__dirname, `session_qr_${uniqueId}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        let isQrSent = false;

        // Socket එක function එකක් ඇතුළට ගත්තා (Reconnect කරන්න ලේසි වෙන්න)
        async function startQRConnection() {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: ["Mac OS", "Safari", "14.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !isQrSent) {
                    if (!res.headersSent) {
                        res.json({ qr: qr });
                        isQrSent = true;
                    }
                }

                if (connection === 'open') {
                    console.log(`[QR SUCCESS] Connected successfully via QR Code. Waiting 10 seconds for keys to settle...`);

                    setTimeout(async () => {
                        const credsPath = path.join(sessionDir, 'creds.json');
                        if (fs.existsSync(credsPath)) {
                            const credsData = fs.readFileSync(credsPath, 'utf8');
                            const base64Session = Buffer.from(credsData).toString('base64');
                            const sessionID = `BABIYA-MD;;;${base64Session}`;

                            const targetJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                            const warningMsg = `*👑 BABIYA-MD SESSION GENERATED 👑*\n\n*⚠️ DO NOT SHARE THIS WITH ANYONE!*`;

                            try {
                                await sock.sendMessage(targetJid, { text: warningMsg });
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                
                                await sock.sendMessage(targetJid, { text: sessionID });
                                console.log("[INFO] Session ID sent successfully via QR Login!");
                            } catch (msgErr) {
                                console.error("[ERROR] Failed to send QR session message:", msgErr);
                            }

                            setTimeout(() => {
                                try {
                                    sock.ws.close();
                                    fs.removeSync(sessionDir);
                                    console.log(`[CLEANUP] Deleted temporary QR session directory.`);
                                } catch (e) {}
                            }, 5000);
                        }
                    }, 10000); 
                }

                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    
                    // මෙන්න මෙතන තමයි මැජික් එක තියෙන්නේ. Disconnect වුණොත් ආයෙත් function එක call කරනවා.
                    if (shouldReconnect) {
                        console.log("[INFO] Connection dropped during QR login. Reconnecting...");
                        startQRConnection(); 
                    } else {
                        fs.removeSync(sessionDir);
                    }
                }
            });
        }

        // පළවෙනි පාරට function එක Call කරනවා
        startQRConnection();

    } catch (error) {
        console.error("QR Process Error:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error" });
        }
    }
});
