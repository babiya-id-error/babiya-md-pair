const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, jidNormalizedUser, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
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
// 1. PAIRING CODE METHOD (FIXED DELAY)
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
                browser: Browsers.ubuntu('Chrome') // 👈 බොට්ගේ එකට ගැලපෙන්න වෙනස් කරා
            });

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    isSaved = true;

                    // ⏳ තත්පර 2ක් ප්‍රමාද කරනවා කනෙක්ශන් එක ස්ටේබල් වෙලා මැසේජ් යවන්න ලෑස්ති වෙනකල්
                    setTimeout(async () => {
                        try {
                            const credsPath = path.join(tempPath, 'creds.json');
                            if (fs.existsSync(credsPath)) {
                                const credsData = fs.readFileSync(credsPath, 'utf-8');
                                const base64Session = Buffer.from(credsData).toString('base64');
                                const sessionId = `BABIYA-MD;;;${base64Session}`;

                                const myJid = jidNormalizedUser(sock.user.id);

                                // 1. සාර්ථක බව පෙන්වන මැසේජ් එක
                                await sock.sendMessage(myJid, { 
                                    text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY!*\n\nDo not share this code with anyone!`
                                });

                                // 2. සෙශන් ID එක
                                await sock.sendMessage(myJid, { 
                                    text: sessionId 
                                });
                            }
                        } catch (msgErr) {
                            console.error("Error sending message:", msgErr.message);
                        } finally {
                            // මැසේජ් ටික ගියාට පස්සේ සෙශන් එක වහලා ටෙම්ප් ෆයිල් මකනවා
                            setTimeout(() => {
                                try { sock.end(); } catch(e){} 
                                if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
                            }, 3000);
                        }
                    }, 2000); // 👈 මෙන්න මේ තත්පර 2ක ප්‍රමාදය තමයි වැඩේ ගොඩදාන්නේ!
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
// 2. QR CODE METHOD (FIXED DELAY)
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
                    
                    // ⏳ තත්පර 2ක ප්‍රමාදය QR එකටත් දානවා
                    setTimeout(async () => {
                        try {
                            const credsPath = path.join(tempQrPath, 'creds.json');
                            if (fs.existsSync(credsPath)) {
                                const credsData = fs.readFileSync(credsPath, 'utf-8');
                                const base64Session = Buffer.from(credsData).toString('base64');
                                const sessionId = `BABIYA-MD;;;${base64Session}`;

                                const myJid = jidNormalizedUser(qrSock.user.id);

                                await qrSock.sendMessage(myJid, { 
                                    text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY (QR)!*\n\nDo not share this code!`
                                });

                                await qrSock.sendMessage(myJid, { 
                                    text: sessionId 
                                });
                            }
                        } catch (msgErr) {
                            console.error("Error sending QR message:", msgErr.message);
                        } finally {
                            setTimeout(() => {
                                try { qrSock.end(); } catch(e){} 
                                if (fs.existsSync(tempQrPath)) fs.rmSync(tempQrPath, { recursive: true, force: true });
                                qrStatus = 'idle';
                            }, 3000);
                        }
                    }, 2000);
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
