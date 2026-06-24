const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log(`🟢 [NEW CONNECTION] Web client connected! ID: ${socket.id}`);

    // Frontend එකෙන් එන දේවල් මොනවද කියලා බලාගන්න
    socket.onAny((eventName, ...args) => {
        console.log(`📥 [EVENT TRIGGERED] Frontend sent: '${eventName}'`);
    });

    // 1. --- QR CODE එක ඉල්ලන කොට වැඩ කරන කෑල්ල ---
    socket.on('get_qr', async () => {
        console.log(`📲 Processing QR Code Request...`);
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'tmp', `qr_${socket.id}`));
        
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
                    socket.emit('qr', qr); // සයිට් එකට QR එක යැවීම
                    console.log(`✅ QR Code sent to frontend!`);
                }
                if (connection === 'open') {
                    socket.emit('connected', 'Successfully Connected!');
                    console.log(`✅ Connection Open!`);
                }
            });
        } catch (err) {
            console.log('❌ QR Error:', err.message);
        }
    });

    // 2. --- PAIRING CODE එක ඉල්ලන කොට වැඩ කරන කෑල්ල ---
    const generatePairingCode = async (phoneNumber) => {
        if (!phoneNumber) return;
        let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
        console.log(`📱 Processing Pairing Code for: ${formattedNumber}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'tmp', `pair_${socket.id}`));

        try {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: 'silent' }),
                browser: ["Babiya-MD", "Chrome", "1.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

            if (!sock.authState.creds.me) {
                await delay(2000); // WhatsApp සර්වර් එකට කනෙක්ට් වෙන්න පොඩි වෙලාවක් දීම
                const code = await sock.requestPairingCode(formattedNumber);
                socket.emit('code', code); // සයිට් එකට Code එක යැවීම
                console.log(`🔑 Pairing Code Generated & Sent: ${code}`);
            }
        } catch (err) {
            console.log('❌ Pairing Code Error:', err.message);
            socket.emit('error', 'Error generating code');
        }
    };

    // UI එකෙන් Pairing code ඉල්ලන්න පාවිච්චි කරන්න පුළුවන් common නම් ඔක්කොම මෙතනට දැම්මා
    socket.on('get_code', generatePairingCode);
    socket.on('submitNumber', generatePairingCode);
    socket.on('pair', generatePairingCode);
    socket.on('get_pair_code', generatePairingCode);
});

server.listen(PORT, () => {
    console.log(`🚀 Babiya Socket Server Active on Port: ${PORT}`);
});
