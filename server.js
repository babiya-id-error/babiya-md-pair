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

app.post('/pair', async (req, res) => {
    let phoneNumber = req.body.phone;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required!" });

    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, `session_${phoneNumber}`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        let isCodeSent = false; 

        // Socket එක රන් කරන ප්‍රධාන function එක
        async function startWhatsAppConnection() {
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: ["Mac OS", "Safari", "14.0.0"]
            });

            sock.ev.on('creds.update', saveCreds);

            // Pairing Code එක ජෙනරේට් කරලා වෙබ් එකට යැවීම
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
                
                // 1. සාර්ථකව කනෙක්ට් වුණොත් (Open)
                if (connection === 'open') {
                    console.log(`[SUCCESS] Connected to ${phoneNumber}`);
                    
                    const credsPath = path.join(sessionDir, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const credsData = fs.readFileSync(credsPath, 'utf8');
                        const base64Session = Buffer.from(credsData).toString('base64');
                        const sessionID = `BABIYA-MD;;;${base64Session}`;

                        // හරිම WhatsApp JID එක හදාගැනීම (Device ID කෑලි නැතුව කෙලින්ම තමන්ගේ නම්බර් එකට මැසේජ් යන්න)
                        const targetJid = `${phoneNumber}@s.whatsapp.net`;

                        const warningMsg = `*👑 BABIYA-MD SESSION GENERATED 👑*\n\n*⚠️ DO NOT SHARE THIS WITH ANYONE!*`;
                        
                        try {
                            // පළවෙනි මැසේජ් එක (Warning එක විතරක් යවනවා)
                            await sock.sendMessage(targetJid, { text: warningMsg });
                            
                            // තත්පර 1ක පරතරයක් දෙනවා මැසේජ් මාරු නොවී පිළිවෙලට යන්න
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            // දෙවෙනි මැසේජ් එක (Session ID එක විතරක් - එක පාරක් ටැප් කරලා ලෙහෙසියෙන් කොපි කරගන්න)
                            await sock.sendMessage(targetJid, { text: sessionID });
                            
                            console.log("[INFO] Messages sent separately and successfully to Yourself!");
                        } catch (msgErr) {
                            console.error("[ERROR] Failed to send messages:", msgErr);
                        }

                        // සොකට් එක වහලා, තාවකාලික ෆයිල් ක්ලියර් කිරීම
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
                }

                // 2. මැදදී කනෙක්ෂන් එක කැඩුනොත් ආයේ ඔටෝ රීකනෙක්ට් වීම
                if (connection === 'close') {
                    const reason = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = reason !== DisconnectReason.loggedOut;
                    
                    console.log(`[CONNECTION CLOSED] Reason Code: ${reason}. Reconnecting: ${shouldReconnect}`);
                    
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

app.listen(PORT, () => {
    console.log(`[BABIYA-MD] Session Generator running on port ${PORT}`);
});
