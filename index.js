const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);

// Socket.io සෙටප් එක (Render වල හිර නොවෙන්න Websocket ප්‍රධාන කර ඇත)
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// public ෆෝල්ඩර් එක ඇතුළේ තියෙන HTML/CSS සයිට් එක පෙන්වීම
app.use(express.static(path.join(__dirname, 'public')));

// වෙබ් එකෙන් කනෙක්ට් වෙන හැමෝටම මේ ෆන්ක්ෂන් එක රන් වෙනවා
io.on('connection', (socket) => {
    console.log('🌐 New user connected to pair site');

    socket.on('submitNumber', async (phoneNumber) => {
        // නම්බර් එකේ තියෙන හිස්තැන් සහ ලකුණු අයින් කිරීම
        let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        console.log(`📱 Generating code for: ${formattedNumber}`);

        // තාවකාලික සෙෂන් එකක් හැදීම (සයිට් එකට විතරක් නිසා)
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'tmp', `session_${socket.id}`));

        try {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ["Babiya Pair", "Chrome", "1.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, qr } = update;

                // 1. වට්සැප් එකෙන් QR ආවොත් සයිට් එකට යැවීම
                if (qr) {
                    socket.emit('qr', qr);
                }

                // 2. සාර්ථකව කනෙක්ට් වුණොත් සයිට් එකට දැනුම් දීම
                if (connection === 'open') {
                    socket.emit('connected', '🎉 Connected Successfully!');
                    // මෙතනදී ඕනෙ නම් සෙෂන් අයිඩී එක වට්සැප් එකට මැසේජ් එකක් විදිහට යවන්න පුළුවන්
                }
            });

            // 3. පේයරින් කෝඩ් එක ඉල්ලලා සයිට් එකට යැවීම
            if (!sock.authState.creds.me) {
                await delay(3000); // පොඩි ඩිලේ එකක් Baileys එකට සෙට් වෙන්න
                const code = await sock.requestPairingCode(formattedNumber);
                socket.emit('code', code); // කෙලින්ම සයිට් එකට කෝඩ් එක යනවා
                console.log(`🔑 Code Sent: ${code}`);
            }

        } catch (err) {
            console.log('Error generation failed:', err);
            socket.emit('error', 'කේතය ලබා ගැනීමට අපොහොසත් විය.');
        }
    });
});

// සර්වර් එක ස්ටාර්ට් කිරීම
server.listen(PORT, () => {
    console.log(`🚀 Pair Site Active on Port: ${PORT}`);
});
