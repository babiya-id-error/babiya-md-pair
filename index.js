const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// public ෆෝල්ඩර් එක ලෝඩ් කිරීම
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`🟢 [NEW CONNECTION] Web client connected! ID: ${socket.id}`);

    // 🔥 සයිට් එකෙන් එවන ඕනෑම ඉවෙන්ට් එකක් (බටන් ක්ලික් එකක්) අල්ලගන්න ඔත්තු බලන කෑල්ල
    socket.onAny((eventName, ...args) => {
        console.log(`📥 [EVENT RECEIVED FROM WEB] Event Name: '${eventName}' | Data:`, args);
    });

    // සාමාන්‍යයෙන් Pairing Number එක එවන Event එක
    socket.on('submitNumber', async (phoneNumber) => {
        let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        console.log(`📱 Processing Code for: ${formattedNumber}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'tmp', `session_${socket.id}`));

        try {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ["Babiya-MD", "Chrome", "1.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, qr } = update;
                if (qr) {
                    socket.emit('qr', qr);
                    console.log(`📲 QR Code sent to web!`);
                }
                if (connection === 'open') {
                    socket.emit('connected', 'Successfully Connected!');
                }
            });

            if (!sock.authState.creds.me) {
                await delay(2000);
                const code = await sock.requestPairingCode(formattedNumber);
                socket.emit('code', code);
                console.log(`🔑 Pairing Code Sent to Web: ${code}`);
            }
        } catch (err) {
            console.log('❌ Error:', err.message);
            socket.emit('error', 'Error generating code');
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Babiya Socket Server Active on Port: ${PORT}`);
});
