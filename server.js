const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, jidNormalizedUser } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let qrSock = null;
let latestQrImage = null;
let qrStatus = 'idle';

// ==========================================
// 1. PAIRING CODE METHOD
// ==========================================
app.post('/api/pair', async (req, res) => {
    let phone = req.body.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required!' });
    phone = phone.replace(/[^0-9]/g, '');

    const tempPath = path.join(__dirname, 'temp_pair_session');
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });

    try {
        const { state, saveCreds } = await useMultiFileAuthState('temp_pair_session');
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                const credsPath = path.join(tempPath, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf-8');
                    const base64Session = Buffer.from(credsData).toString('base64');
                    const sessionId = `BABIYA-MD;;;${base64Session}`;

                    // සාර්ථකව ක්ලීන් කරපු ජිඩ් (JID) එකට මැසේජ් එක යවනවා
                    const myJid = jidNormalizedUser(sock.user.id);
                    await sock.sendMessage(myJid, { 
                        text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY!*\n\n*Your Session ID:*\n\n\`\`\`${sessionId}\`\`\`\n\nDo not share this code!`
                    });

                    setTimeout(() => {
                        try { sock.end(); } catch(e){} 
                        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
                    }, 5000);
                }
            }
        });

        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phone);
                res.json({ code: code });
            } catch (err) {
                res.json({ error: 'WhatsApp Core Error. Try again.' });
            }
        }, 5000);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==========================================
// 2. QR CODE METHOD (FIXED)
// ==========================================
app.get('/api/qr/start', async (req, res) => {
    const tempQrPath = path.join(__dirname, 'temp_qr_session');
    if (fs.existsSync(tempQrPath)) fs.rmSync(tempQrPath, { recursive: true, force: true });

    latestQrImage = null;
    qrStatus = 'scanning';

    async function connectWhatsAppQR() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState('temp_qr_session');
            qrSock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ["Ubuntu", "Chrome", "20.0.04"] 
            });

            qrSock.ev.on('creds.update', saveCreds);
            
            qrSock.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;

                if (connection) {
                    console.log(`[QR STATUS UPDATE]: Connection is ${connection}`);
                }

                if (qr) {
                    latestQrImage = await QRCode.toDataURL(qr);
                }

                if (connection === 'open') {
                    qrStatus = 'success';
                    console.log("[SUCCESS] WhatsApp Connected Successfully!");
                    
                    const credsPath = path.join(tempQrPath, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf-8');
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const sessionId = `BABIYA-MD;;;${base64Session}`;

                        
                        const myJid = jidNormalizedUser(qrSock.user.id);
                        console.log(`[SENDING] Sending Session ID to: ${myJid}`);

                        await qrSock.sendMessage(myJid, { 
                            text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY (QR)!*\n\n*Your Session ID:*\n\n\`\`\`${sessionId}\`\`\`\n\nDo not share this code!`
                        });

                        setTimeout(() => {
                            try { qrSock.end(); } catch(e){} 
                            if (fs.existsSync(tempQrPath)) fs.rmSync(tempQrPath, { recursive: true, force: true });
                            qrStatus = 'idle';
                        }, 5000);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    console.log(`[CLOSE] Connection closed. Status Code: ${statusCode}`);
                    
                    if (statusCode === 401) {
                        qrStatus = 'error';
                        console.log("[ERROR] Session expired or logged out (401).");
                    } else if (qrStatus !== 'success' && qrStatus !== 'idle') {
                        console.log("[RECONNECTING] Reconnecting to complete login process...");
                        setTimeout(() => {
                            connectWhatsAppQR();
                        }, 2000);
                    }
                }
            });
        } catch (err) {
            console.log("[SOCKET ERROR]: ", err.message);
        }
    }

    connectWhatsAppQR();
    res.json({ status: 'started' });
});

app.get('/api/qr/poll', (req, res) => {
    res.json({ status: qrStatus, qr: latestQrImage });
});

app.listen(PORT, () => {
    console.log(`\n🌐 [SERVER RUNNING] http://localhost:${PORT}`);
});
