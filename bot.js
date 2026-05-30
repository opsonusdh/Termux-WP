const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
const server = http.createServer(app);

// --- WHATSAPP CLIENT STATE TRACKING ---
let clientState = "INITIALIZING";
let lastQR = null;

// --- 1. PERSISTENT WEBSOCKET SERVER CONFIGURATION ---
const wss = new WebSocket.Server({ server });

// Function to broadcast structural events to all connected WebSocket interfaces
function broadcast(event, payload) {
    const data = JSON.stringify({ 
        event, 
        payload, 
        timestamp: new Date().toISOString() 
    });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Keep WebSocket connections alive across networks using automated heartbeat pings
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // Immediately send the current status upon connection
    ws.send(JSON.stringify({
        event: "SYSTEM_STATUS",
        payload: { state: clientState, qr: lastQR },
        timestamp: new Date().toISOString()
    }));
});

setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000); // Verify every 30 seconds

// --- 2. HTTP GET/POST API ENDPOINTS ---

// API Endpoint 0: Check System Status
app.get('/api/status', (req, res) => {
    return res.status(200).json({
        success: true,
        state: clientState,
        qr: lastQR
    });
});

// API Endpoint 1: Send Outbound Message (POST)
app.post('/api/send', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: "Parameters missing: 'to' and 'message' are required." });
    }

    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;

    try {
        const response = await whatsappClient.sendMessage(targetId, message);
        return res.status(200).json({ success: true, messageId: response.id.id, status: "sent" });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// API Endpoint 2: Fetch Last N Messages Directly From Cloud Servers (POST)
app.post('/api/context', async (req, res) => {
    const { to, limit } = req.body;
    if (!to) {
        return res.status(400).json({ error: "Parameter missing: 'to' is required." });
    }

    const fetchLimit = parseInt(limit) || 10; // Default to last 10 messages if unspecified
    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;

    try {
        const chat = await whatsappClient.getChatById(targetId);
        const rawHistory = await chat.fetchMessages({ limit: fetchLimit });

        const history = rawHistory.map(m => ({
            timestamp: new Date(m.timestamp * 1000).toISOString(),
            direction: m.fromMe ? 'OUTBOUND' : 'INBOUND',
            body: m.body
        }));

        return res.status(200).json({ success: true, phone: targetId, history: history });
    } catch (error) {
        return res.status(500).json({ success: false, error: "Could not fetch chat timeline: " + error.message });
    }
});

// --- 3. WHATSAPP BROWSER ENGINE ARCHITECTURE ---
const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-gpu', 
            '--headless=new', 
            '--ignore-certificate-errors', 
            '--ignore-ssl-errors'
        ],
        executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser'
    }
});

whatsappClient.on('qr', (qr) => {
    clientState = "QR_REQUIRED";
    lastQR = qr;
    console.log('--- SCAN QR CODE WITH WHATSAPP TO CONNECT ---');
    qrcode.generate(qr, { small: true });
    broadcast('SYSTEM_QR_REQUIRED', { qr, info: "Scan authorization required." });
});

whatsappClient.on('ready', () => {
    clientState = "READY";
    lastQR = null;
    console.log('\nSystem Connected! Your phone is now sending and receiving.');
    broadcast('SYSTEM_READY', { status: "online", source: "Termux Android Core" });
});

whatsappClient.on('authenticated', () => {
    clientState = "AUTHENTICATED";
    console.log('WhatsApp authenticated successfully.');
    broadcast('SYSTEM_AUTHENTICATED', { status: "authenticated" });
});

whatsappClient.on('auth_failure', (msg) => {
    clientState = "AUTH_FAILURE";
    lastQR = null;
    console.error('Authentication failure:', msg);
    broadcast('SYSTEM_AUTH_FAILURE', { error: msg });
});

whatsappClient.on('disconnected', (reason) => {
    clientState = "DISCONNECTED";
    lastQR = null;
    console.log('🔌 WhatsApp client disconnected:', reason);
    broadcast('SYSTEM_DISCONNECTED', { reason });
});

// Capture Incoming Traffic Streams
whatsappClient.on('message_create', async (msg) => {
    // Ignore internal system logs generated by your own responses
    if (msg.fromMe) return;

    try {
        const chat = await msg.getChat();
        const CONTEXT_LOOKUP_LIMIT = 3; // Loads the last 3 messages automatically on new incoming texts per user request
        const rawHistory = await chat.fetchMessages({ limit: CONTEXT_LOOKUP_LIMIT });

        const contextHistory = rawHistory.map(m => ({
            timestamp: new Date(m.timestamp * 1000).toISOString(),
            direction: m.fromMe ? 'OUTBOUND' : 'INBOUND',
            body: m.body
        }));

        const eventPayload = {
            messageId: msg.id.id,
            sender: msg.from,
            profileName: msg._data?.notifyName || "Anonymous",
            text: msg.body,
            isGroup: msg.from.endsWith('@g.us'),
            context_history: contextHistory
        };

        // Stream event over your WebSocket cluster instantly
        broadcast('MESSAGE_RECEIVED', eventPayload);
        console.log(`[WS Broadcast] New Message from ${eventPayload.profileName}: "${msg.body}"`);

    } catch (err) {
        console.error("Error generating tracking event payload:", err.message);
    }
});

// --- 4. START SERVICE LAYER ---
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`API Server & WebSocket engine deployed on port ${PORT}`);
    whatsappClient.initialize();
});
