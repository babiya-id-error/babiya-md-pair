const express = require('express');
const http = require('http');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// 1. සයිට් එකට එන හැම රික්වෙස්ට් එකක්ම Render Logs වල පෙන්වන මැද කෑල්ල (Middleware)
app.use((req, res, next) => {
    console.log(`👉 [REQUEST RECEIVED] ${req.method} ${req.url}`);
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// 2. වෙබ් UI එකෙන් සාමාන්‍ය ක්‍රමයට (Fetch/Axios) නම්බර් එක එවද්දී වැඩ කරන ප්‍රධාන ලොජික් එක
const handlePairingRequest = async (req, res) => {
    let phoneNumber = req.query.number || req.query.phone || req.query.code;
    
    if (!phoneNumber) {
        console.log(`⚠️ Number is missing in request query`);
        return res.status(400).json({ error: "Number missing" });
    }

    let formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
    console.log(`📱 Generating Pairing Code for WhatsApp Number: ${formattedNumber}`);

    // හැම රික්වෙස්ට් එකකටම තාවකාලික සෙෂන් එකක් හැදීම
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'tmp', `session_${Date.now()}`));

    try {
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.me) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(formattedNumber);
                    console.log(`🔑 Successfully Generated Pairing Code: ${code}`);
                    
                    // Frontend එක බලාපොරොත්තු වන ස්ටෑන්ඩර්ඩ් JSON Response එක දීම
                    return res.json({ code: code, status: true });
                } catch (e) {
                    console.log(`❌ WhatsApp Server Blocked or Error:`, e.message);
                    return res.status(500).json({ error: "WhatsApp connection failed" });
                }
            }, 3000);
        }
    } catch (err) {
        console.log(`❌ Server Setup Error:`, err.message);
        return res.status(500).json({ error: err.message });
    }
};

// බහුලවම පාවිච්චි වන රූට්ස් ඔක්කොටම සපෝට් එක දීම
app.get('/code', handlePairingRequest);
app.get('/pair', handlePairingRequest);
app.get('/api/pair', handlePairingRequest);

// සර්වර් එක ස්ටාර්ට් කිරීම
server.listen(PORT, () => {
    console.log(`🚀 Babiya Pair Site Active and Listening on Port: ${PORT}`);
});
