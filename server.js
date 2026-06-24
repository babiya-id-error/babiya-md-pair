const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, jidNormalizedUser, Browsers, DisconnectReason, BufferJSON } = require('@whiskeysockets/baileys');
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
// 1. PAIRING CODE METHOD (FIXED & MEMORY SYNC)
// ==========================================
app.post('/api/pair', async (req, res) => {
    let phone = req.body.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required!' });
    phone = phone.replace(/[^0-9]/g, '');

    const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const tempPath = path.join(__dirname, `temp_pair_${uniqueId}`);

    let isSaved = false;

    async function startPairing() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(tempPath);
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: Browsers.ubuntu('Chrome')
            });

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    isSaved = true;
                    
                    // 🔥 FIXED: ෆයිල් කියවන්නේ නැතුව රැම් එකේ තියෙන ලයිව් ක්‍රෙඩෙන්ෂල්ස් BufferJSON හරහාම Base64 කරනවා
                    const base64Session = Buffer.from(BufferJSON.stringify(state.creds)).toString('base64');
                    const sessionId = `BABIYA-MD;;;${base64Session}`;

                    const myJid = jidNormalizedUser(sock.user.id);

                    // 1. සාර්ථක බව පෙන්වන මැසේජ් එක
                    await sock.sendMessage(myJid, { 
                        text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY!*\n\nDo not share this code with anyone!`
                    });

                    // 2. සෙශන් ID එක වෙනමම මැසේජ් එකක් ලෙස
                    await sock.sendMessage(myJid, { 
                        text: sessionId 
                    });

                    setTimeout(() => {
                        try { sock.end(); } catch(e){} 
                        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
                    }, 5000);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== DisconnectReason.loggedOut && !isSaved) {
                        console.log("[PAIRING] Reconnecting to finalize setup...");
                        setTimeout(() => startPairing(), 2000);
                    } else if (isSaved) {
                        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
                    }
                }
            });

            if (!fs.existsSync(path.join(tempPath, 'creds.json')) || !state.creds.me) {
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(phone);
                        if (!res.headersSent) {
                            res.json({ code: code });
                        }
                    } catch (err) {
                        if (!res.headersSent) {
                            res.json({ error: 'WhatsApp Core Error. Try again.' });
                        }
                    }
                }, 3000);
            }

        } catch (err) {
            if (!res.headersSent) res.status(500).json({ error: err.message });
        }
    }

    startPairing();
});

// ==========================================
// 2. QR CODE METHOD (FIXED MEMORY SYNC)
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
                browser: Browsers.ubuntu('Chrome')
            });

            qrSock.ev.on('creds.update', saveCreds);
            
            qrSock.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;

                if (qr) {
                    latestQrImage = await QRCode.toDataURL(qr);
                }

                if (connection === 'open') {
                    qrStatus = 'success';
                    
                    // 🔥 FIXED: QR එකටත් රැම් එකෙන්ම කෙලින්ම BufferJSON හරහා කේතනය කරනවා
                    const base64Session = Buffer.from(BufferJSON.stringify(state.creds)).toString('base64');
                    const sessionId = `BABIYA-MD;;;${base64Session}`;

                    const myJid = jidNormalizedUser(qrSock.user.id);

                    await qrSock.sendMessage(myJid, { 
                        text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY (QR)!*\n\nDo not share this code!`
                    });

                    await qrSock.sendMessage(myJid, { 
                        text: sessionId 
                    });

                    setTimeout(() => {
                        try { qrSock.end(); } catch(e){} 
                        if (fs.existsSync(tempQrPath)) fs.rmSync(tempQrPath, { recursive: true, force: true });
                        qrStatus = 'idle';
                    }, 5000);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        qrStatus = 'error';
                    } else if (qrStatus !== 'success' && qrStatus !== 'idle') {
                        setTimeout(() => connectWhatsAppQR(), 2000);
                    }
                }
            });
        } catch (err) {
            console.log(err.message);
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
