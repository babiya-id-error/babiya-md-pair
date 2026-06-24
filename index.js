const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    let sock = null;
    let sessionDir = null;

    // Baileys Socket එක පණගන්වන පොදු ෆන්ක්ෂන් එක
    async function startWhatsAppLogic(phone = null) {
        sessionDir = `./session_${Date.now()}`;
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;

            // QR කේතය ලැබුණු විට එය ඉමේජ් එකක් කර වෙබ් එකට යැවීම
            if (qr && !phone) {
                try {
                    const qrImageUrl = await QRCode.toDataURL(qr);
                    socket.emit('qr_code', qrImageUrl);
                } catch (err) {
                    socket.emit('server_message', '❌ QR එක සාදා ගැනීමට නොහැකි විය.');
                }
            }

            // කනෙක්ශන් එක සාර්ථක වුණොත්
            if (connection === 'open') {
                socket.emit('server_message', '🔄 සෙෂන් එක සකසමින් පවතී...');
                await delay(5000);

                const credsPath = path.join(sessionDir, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf8');
                    const base64Session = Buffer.from(credsData).toString('base64');
                    const sessionId = `BABIYA-MD;;;${base64Session}`;

                    const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

                    // මැසේජ් 2ක් යවනවා (කොපි කරගන්න ලේසි වෙන්න)
                    await sock.sendMessage(myJid, { 
                        text: `👑 *BABIYA-MD SESSION CONNECTED* 👑\n\n⚠️ *මෙම කෝඩ් එක කා සමඟවත් බෙදා නොගන්න!*` 
                    });
                    await sock.sendMessage(myJid, { text: sessionId });

                    socket.emit('login_success', '🎉 නියමයි! Session ID එක ඔබේ WhatsApp ගිණුමට සාර්ථකව එවා ඇත.');
                }
                clearSessionFiles();
            }
        });

        // ජංගම දුරකථන අංකය තිබේ නම් Pairing Code එක ඉල්ලීම
        if (phone) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phone);
                    socket.emit('pairing_code', code);
                } catch (err) {
                    socket.emit('server_message', '❌ Pairing Code එක ලබා ගැනීමට අපොහොසත් විය.');
                }
            }, 3000);
        }
    }

    // වෙබ් එකෙන් QR ඉල්ලන විට
    socket.on('get_qr', async () => {
        clearSessionFiles();
        startWhatsAppLogic();
    });

    // වෙබ් එකෙන් කෝඩ් ඉල්ලන විට
    socket.on('get_code', async (phone) => {
        clearSessionFiles();
        startWhatsAppLogic(phone.replace(/[^0-9]/g, ''));
    });

    function clearSessionFiles() {
        try {
            if (sock) {
                sock.ev.removeAllListeners('connection.update');
                sock.ev.removeAllListeners('creds.update');
            }
            if (sessionDir && fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        } catch (e) {}
    }

    socket.on('disconnect', () => {
        clearSessionFiles();
    });
});

server.listen(PORT, () => console.log(`Server active on port ${PORT}`));
