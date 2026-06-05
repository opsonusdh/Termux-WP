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
    const { to, message, quotedMessageId } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: "Parameters missing: 'to' and 'message' are required." });
    }
    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;
    try {
        const msgOptions = {};
        if (quotedMessageId) {
            // Pass the serialized ID directly — whatsapp-web.js resolves it internally
            msgOptions.quotedMessageId = quotedMessageId;
        }
        const response = await whatsappClient.sendMessage(targetId, message, msgOptions);
        return res.status(200).json({ success: true, messageId: response.id._serialized, status: "sent" });
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

// API Endpoint 3: List All Chats and Groups
app.get('/api/chats', async (req, res) => {
    if (clientState !== "READY") {
        return res.status(503).json({ success: false, error: "WhatsApp client not ready.", state: clientState });
    }
    try {
        const raw = await whatsappClient.getChats();
        const chats = raw.map(chat => ({
            jid:           chat.id._serialized,
            name:          chat.name || chat.id.user || "Unknown",
            type:          chat.isGroup ? "group" : "dm",
            unread:        chat.unreadCount || 0,
            lastMessageAt: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
            isArchived:    chat.archived  || false,
            isMuted:       chat.isMuted   || false,
            isPinned:      chat.pinned    || false,
        }));
        // Pinned first, then sorted by most recent message
        chats.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt);
            return 0;
        });
        return res.status(200).json({ success: true, count: chats.length, chats });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 4: Show typing indicator
app.post('/api/typing', async (req, res) => {
    const { to, duration } = req.body;
    if (!to) return res.status(400).json({ error: "'to' is required." });
    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;
    try {
        const chat = await whatsappClient.getChatById(targetId);
        await chat.sendStateTyping();
        // Auto-clear as a safety net — the actual message send clears it too
        setTimeout(() => chat.clearState().catch(() => {}), duration || 15000);
        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 5: Mark chat as read (clears unread badge)
app.post('/api/seen', async (req, res) => {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: "'to' is required." });
    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;
    try {
        const chat = await whatsappClient.getChatById(targetId);
        await chat.sendSeen();
        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 6: React to a message with an emoji
app.post('/api/react', async (req, res) => {
    const { messageId, emoji } = req.body;
    if (!messageId || !emoji) return res.status(400).json({ error: "'messageId' and 'emoji' are required." });
    try {
        const msg = await whatsappClient.getMessageById(messageId);
        await msg.react(emoji);
        return res.status(200).json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 7: Get contact info (name, number, about, profile pic)
app.get('/api/contact/:jid', async (req, res) => {
    const jid = req.params.jid;
    try {
        const contact = await whatsappClient.getContactById(jid);
        const info = {
            jid:         contact.id._serialized,
            name:        contact.name || contact.pushname || null,
            number:      contact.number,
            isMyContact: contact.isMyContact,
            isBlocked:   contact.isBlocked,
            isBusiness:  contact.isBusiness,
            about:       null,
            profilePicUrl: null,
        };
        try { info.about         = await contact.getAbout(); }         catch (_) {}
        try { info.profilePicUrl = await contact.getProfilePicUrl(); } catch (_) {}
        return res.status(200).json({ success: true, contact: info });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 8: Get group participant list
app.get('/api/group/:jid/participants', async (req, res) => {
    const jid = req.params.jid;
    try {
        const chat = await whatsappClient.getChatById(jid);
        if (!chat.isGroup) return res.status(400).json({ success: false, error: "Not a group chat." });
        const participants = chat.participants.map(p => ({
            jid:         p.id._serialized,
            number:      p.id.user,
            isAdmin:     p.isAdmin,
            isSuperAdmin: p.isSuperAdmin,
        }));
        return res.status(200).json({ success: true, groupName: chat.name, count: participants.length, participants });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 9: Download media from a specific message (on-demand, not automatic)
app.post('/api/media', async (req, res) => {
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ error: "'messageId' is required." });
    try {
        const msg = await whatsappClient.getMessageById(messageId);
        if (!msg.hasMedia) return res.status(400).json({ success: false, error: "Message has no media." });
        const media = await msg.downloadMedia();
        if (!media) return res.status(500).json({ success: false, error: "Media download returned null." });
        return res.status(200).json({
            success:  true,
            mimetype: media.mimetype,
            filename: media.filename || null,
            data:     media.data,   // base64-encoded binary
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 10: Search messages in a chat
app.post('/api/search', async (req, res) => {
    const { to, query, limit } = req.body;
    if (!to || !query) return res.status(400).json({ error: "'to' and 'query' are required." });
    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;
    try {
        const results = await whatsappClient.searchMessages(query, { chatId: targetId, limit: limit || 20 });
        const hits = results.map(m => ({
            messageId:  m.id._serialized,
            timestamp:  new Date(m.timestamp * 1000).toISOString(),
            direction:  m.fromMe ? 'OUTBOUND' : 'INBOUND',
            body:       m.body,
            type:       m.type,
        }));
        return res.status(200).json({ success: true, count: hits.length, results: hits });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// API Endpoint 11: Archive or unarchive a chat
app.post('/api/archive', async (req, res) => {
    const { to, archive } = req.body;
    if (!to) return res.status(400).json({ error: "'to' is required." });
    const targetId = to.includes('@') ? to : `${to.replace(/[+\s]/g, '')}@c.us`;
    try {
        const chat = await whatsappClient.getChatById(targetId);
        const shouldArchive = archive !== false;
        await chat.archive(shouldArchive);
        return res.status(200).json({ success: true, archived: shouldArchive });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
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

whatsappClient.on('ready', async () => {
    clientState = "READY";
    lastQR = null;
    console.log('\nSystem Connected! Your phone is now sending and receiving.');
    // Resolve the session owner's number from the live WhatsApp session.
    // This is the only place identity is derived — no config file, no hardcoding.
    try {
        const me = whatsappClient.info;
        if (me?.wid?.user) {
            resolvedMyNumber = me.wid.user;
            console.log(`[Session] Owner number resolved: ${resolvedMyNumber}`);
        }
    } catch (_) {}
    broadcast('SYSTEM_READY', {
        status: "online",
        source: "Termux Android Core",
        myNumber: resolvedMyNumber,   // Python side stores this for its own mention fallback
    });
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
    console.log('WhatsApp client disconnected:', reason);
    broadcast('SYSTEM_DISCONNECTED', { reason });
});

// Deduplicate message IDs — fetchMessages can re-fire message_create on first chat load
const _processedMsgIds = new Set();

// The logged-in user's phone number — resolved from the WhatsApp session on 'ready'.
// Never hardcoded; safe to publish on GitHub.
let resolvedMyNumber = null;

// --- Helper: did this message @mention the session owner? ---
// Reads identity directly from the live WhatsApp session — no config, no hardcoding.
//
// IMPORTANT: msg.mentionedIds is an array of ContactId OBJECTS {server, user, _serialized},
// NOT plain strings — even though the docs show it as strings. We handle both defensively.
// getMentions() is used as an authoritative async fallback in case the format is unexpected.
async function didMentionMe(msg) {
    try {
        const myWid  = whatsappClient.info?.wid;
        const myJid  = myWid?._serialized;              // e.g. "919876543210@c.us"
        const myUser = myWid?.user || resolvedMyNumber; // e.g. "919876543210"
        if (!myJid && !myUser) return false;

        // Fast path: check mentionedIds — handles both string and ContactId object formats
        for (const entry of (msg.mentionedIds ?? [])) {
            const jidStr = (typeof entry === 'string') ? entry : (entry?._serialized ?? '');
            if (!jidStr) continue;
            const numStr = jidStr.split('@')[0];
            if (myJid && jidStr === myJid)   return true;
            if (myUser && numStr === myUser) return true;
        }

        // Authoritative fallback: getMentions() always resolves full Contact objects.
        // Catches edge cases where mentionedIds had an unexpected format or was empty
        // despite a real @mention occurring (e.g. some WA versions omit mentionedIds).
        const mentions = await msg.getMentions();
        for (const contact of (mentions ?? [])) {
            const cJid = contact.id?._serialized ?? '';
            const cNum = contact.id?.user         ?? '';
            if (myJid && cJid === myJid)   return true;
            if (myUser && cNum === myUser) return true;
        }

    } catch (err) {
        console.error('[didMentionMe] Error:', err.message);
    }
    return false;
}

// --- Helper: extract media metadata without downloading the binary ---
// Returns an object describing type, caption, mimetype, filename, etc.
// Never triggers a media download — only reads fields already on the msg object.
function extractMediaInfo(msg) {
    const msgType = (msg.type || 'chat').toLowerCase();

    // Plain text — no media
    if (msgType === 'chat' || msgType === 'text') {
        return { type: 'text', hasMedia: false };
    }

    const info = {
        type:    msgType,          // 'image'|'video'|'audio'|'ptt'|'sticker'|
                                   // 'document'|'location'|'vcard'|'revoked'|…
        hasMedia: msg.hasMedia || false,
        caption:  msg.body || null, // WhatsApp puts caption in body for image/video
    };

    // Fields on _data that are available without a download
    const d = msg._data || {};
    if (d.mimetype)   info.mimetype   = d.mimetype;
    if (d.filename)   info.filename   = d.filename;
    if (d.size)       info.size       = d.size;       // bytes
    if (d.duration)   info.duration   = d.duration;   // seconds (audio/video/ptt)
    if (d.width)      info.width      = d.width;
    if (d.height)     info.height     = d.height;
    if (d.isGif)      info.isGif      = d.isGif;
    if (d.isViewOnce) info.isViewOnce = d.isViewOnce;

    // Sticker-specific
    if (msgType === 'sticker') {
        if (d.isAnimated    !== undefined) info.isAnimated   = d.isAnimated;
        if (d.stickerPackId)               info.stickerPackId = d.stickerPackId;
    }

    // Location carries lat/lng directly on msg.location
    if (msgType === 'location') {
        info.hasMedia = false;
        if (msg.location) {
            info.latitude    = msg.location.latitude;
            info.longitude   = msg.location.longitude;
            info.description = msg.location.description || null;
        }
    }

    // vCard: raw vcard text is already in body
    if (msgType === 'vcard' || msgType === 'multi_vcard') {
        info.hasMedia = false;
        info.vcard = msg.body || null;
    }

    if (msgType === 'revoked') {
        info.hasMedia = false;
    }

    return info;
}

// --- Helper: short label for console log ---
function mediaLabel(mediaInfo) {
    switch (mediaInfo.type) {
        case 'text':        return `"${mediaInfo.caption}"`;
        case 'image':       return mediaInfo.caption ? `[Image] "${mediaInfo.caption}"` : '[Image]';
        case 'video':       return mediaInfo.isGif   ? '[GIF]'   : (mediaInfo.caption ? `[Video] "${mediaInfo.caption}"` : '[Video]');
        case 'audio':       return '[Audio]';
        case 'ptt':         return '[Voice note]';
        case 'sticker':     return mediaInfo.isAnimated ? '[Animated sticker]' : '[Sticker]';
        case 'document':    return `[Document${mediaInfo.filename ? ': ' + mediaInfo.filename : ''}]`;
        case 'location':    return `[Location: ${mediaInfo.latitude}, ${mediaInfo.longitude}]`;
        case 'vcard':       return '[Contact card]';
        case 'multi_vcard': return '[Contact cards]';
        case 'revoked':     return '[Deleted message]';
        default:            return `[${mediaInfo.type}]`;
    }
}

// --- Helper: context history entries — media-aware ---
function buildContextHistory(rawHistory) {
    return rawHistory.map(m => {
        const mType = (m.type || 'chat').toLowerCase();
        const entry = {
            timestamp: new Date(m.timestamp * 1000).toISOString(),
            direction: m.fromMe ? 'OUTBOUND' : 'INBOUND',
            type:      mType,
            body:      m.body || null,
        };
        if (mType !== 'chat' && mType !== 'text') {
            entry.mediaType = mType;
            if (m._data?.mimetype) entry.mimetype = m._data.mimetype;
        }
        return entry;
    });
}

// Capture Incoming Traffic Streams
whatsappClient.on('message_create', async (msg) => {
    // Ignore internal system logs generated by your own responses
    if (msg.fromMe) return;

    // Drop duplicate events (fetchMessages triggers message_create on first chat load)
    const msgId = msg.id._serialized || msg.id.id;
    if (_processedMsgIds.has(msgId)) return;
    _processedMsgIds.add(msgId);
    if (_processedMsgIds.size > 500) {
        const first = _processedMsgIds.values().next().value;
        _processedMsgIds.delete(first);
    }

    try {
        const chat = await msg.getChat();
        const isGroup = msg.from.endsWith('@g.us');

        const CONTEXT_LOOKUP_LIMIT = 3;
        const rawHistory = await chat.fetchMessages({ limit: CONTEXT_LOOKUP_LIMIT });

        const contextHistory = buildContextHistory(rawHistory);

        // Detect @mention in groups — Python side uses this to gate auto-replies
        const mentionedMe = isGroup ? await didMentionMe(msg) : false;

        // Debug: log raw mentionedIds so you can verify the format in your terminal
        if (isGroup) {
            const rawIds = (msg.mentionedIds ?? []).map(e =>
                typeof e === 'string' ? e : JSON.stringify(e)
            ).join(', ') || '(none)';
            console.log(`[Mention] group="${chat.name}" | mentionedIds=[${rawIds}] | result=${mentionedMe}`);
        }

        // For group messages, capture the actual sender's number (author field)
        // msg.from is the group JID; msg.author is the sender's number JID
        const groupSender = isGroup ? (msg.author || null) : null;

        // Extract media metadata (never downloads the binary)
        const mediaInfo = extractMediaInfo(msg);

        const eventPayload = {
            messageId:   msg.id._serialized,  // full serialized ID — needed for quoted replies
            sender:      msg.from,           // group JID for groups, number@c.us for DMs
            groupSender: groupSender,         // actual sender JID inside group (null for DMs)
            profileName: msg._data?.notifyName || "Anonymous",
            text:        msg.body || null,    // text body / caption (null for pure media)
            isGroup:     isGroup,
            chatName:    chat.name || null,   // group/contact display name
            mentionedMe: mentionedMe,         // true only if owner was @mentioned in group
            media:       mediaInfo,           // type, hasMedia, caption, mimetype, etc.
            context_history: contextHistory,
        };

        // Stream event over your WebSocket cluster instantly
        broadcast('MESSAGE_RECEIVED', eventPayload);
        console.log(`[WS Broadcast] ${eventPayload.profileName} (group=${isGroup}, mention=${mentionedMe}): ${mediaLabel(mediaInfo)}`);

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
