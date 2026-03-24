const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const { initDB, getDB } = require('./db');
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

const { generateToken04 } = require('./zegoServerAssistant');

// 🔥 Firebase Admin SDK for Push Notifications
let firebaseAdmin = null;

// ... (existing firebase setup)


try {
    const admin = require('firebase-admin');
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    firebaseAdmin = admin;
    console.log('✅ Firebase Admin SDK initialized successfully');
} catch (err) {
    console.warn('⚠️ Firebase Admin SDK not available:', err.message);
}

// Helper function to send push notification
async function sendPushNotification(fcmToken, title, body, data = {}) {
    if (!firebaseAdmin || !fcmToken) {
        console.log('⏭️ Push notification skipped (no Firebase or no token)');
        return false;
    }

    try {
        const isCall = data.type === 'call_offer';
        const message = {
            token: fcmToken,
            data: {
                ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
                title: String(title),
                body: String(body),
                click_action: 'FLUTTER_NOTIFICATION_CLICK'
            },
            android: {
                priority: 'high',
                // For calls: Use data-only message (no notification field)
                // This ensures the app's data handler fires even when killed
                ...(isCall ? {} : {
                    notification: {
                        channelId: 'default_channel',
                        sound: 'default',
                        priority: 'high',
                        defaultSound: true,
                        defaultVibrateTimings: true
                    }
                })
            }
        };

        // For non-call messages, also include notification field for system tray display
        if (!isCall) {
            message.notification = {
                title: title,
                body: body
            };
        } else {
            // STRICTLY REMOVE notification for calls to ensure data-only message
            delete message.notification;
            if (message.android && message.android.notification) {
                delete message.android.notification;
            }
        }

        console.log('🚀 Sending FCM:', JSON.stringify(message, null, 2));

        const response = await firebaseAdmin.messaging().send(message);
        console.log('📲 Push notification sent successfully:', response);
        return true;
    } catch (error) {
        console.error('❌ Push notification failed:', error.message);
        return false;
    }
}

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();

app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

app.use(cors());
app.use(express.json());

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/recordings', express.static(path.join(__dirname, 'public/recordings')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// 🔑 ZEGO TOKEN GENERATION API (Server-Side)
// ---------------------------------------------------------
app.post('/api/generate-zego-token', (req, res) => {
    const { userId, roomId, userName } = req.body;

    if (!userId || !roomId) {
        return res.status(400).json({ error: 'Missing userId or roomId' });
    }

    const appID = Number(process.env.ZEGO_APP_ID) || 1764615906;
    const serverSecret = process.env.ZEGO_SERVER_SECRET || "f1f81d43f20b5007001bf5353a433c59";
    const effectiveTimeInSeconds = 3600;

    try {
        const payload = JSON.stringify({
            room_id: roomId,
            privilege: {
                1: 1,
                2: 1
            },
            stream_id_list: []
        });

        const token = generateToken04(
            appID,
            userId,
            serverSecret,
            effectiveTimeInSeconds,
            payload
        );

        console.log(`🔑 [SERVER] Generated Zego Token for ${userId} in Room ${roomId}`);
        res.json({ token, appID });
    } catch (err) {
        console.error("❌ Token Generation Error:", err);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

// 🔧 ZEGO TOKEN GENERATION for Native Calling Engine
const ZEGO_APP_ID = Number(process.env.ZEGO_APP_ID) || 1764615906;
const ZEGO_SERVER_SECRET = process.env.ZEGO_SERVER_SECRET || 'f1f81d43f20b5007001bf5353a433c59';

app.get('/api/zego-token', (req, res) => {
    const { userID } = req.query;
    if (!userID) return res.status(400).json({ error: 'userID required' });

    // Normalize userID to alphanumeric to match web client normalization
    const normalizedUserID = String(userID).replace(/[^a-zA-Z0-9]/g, '');

    const payload = JSON.stringify({
        privilege: { 1: 1, 2: 1 },
        stream_id_list: []
    });

    const token = generateToken04(ZEGO_APP_ID, normalizedUserID, ZEGO_SERVER_SECRET, 7200, payload);
    console.log(`🔑 [GET] Generated Zego Token for ${normalizedUserID} (len: ${token.length})`);
    res.json({ token, appID: ZEGO_APP_ID, userID: normalizedUserID });
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let db;

app.get('/api', (req, res) => {
    res.json({
        status: 'ok',
        message: 'WaveChat Backend API',
        version: '1.0.2'
    });
});

// --- ADMIN API ENDPOINTS ---

// --- CALL REJECT API (for native Android Decline button when app is killed) ---
app.post('/api/reject-call', async (req, res) => {
    try {
        const { callerId, receiverId } = req.body;
        if (!callerId) return res.status(400).json({ error: 'callerId required' });

        const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
        // Notify caller that call was rejected
        [clean(callerId), callerId].forEach(r => socket.to(r).emit('call_rejected'));

        // Update call log
        if (receiverId) {
            try {
                await db.run("UPDATE calls SET status = 'rejected' WHERE callerId = ? AND receiverId = ? AND status = 'missed' ORDER BY timestamp DESC LIMIT 1",
                    [callerId, receiverId]);
            } catch (e) { }
        }

        console.log('📞 Call rejected via HTTP API from:', receiverId, 'to caller:', callerId);
        res.json({ success: true });
    } catch (e) {
        console.error('Reject call API error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// 1. Get Real-Time Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const userCount = await db.get("SELECT COUNT(*) as count FROM users");
        const msgCount = await db.get("SELECT COUNT(*) as count FROM messages");
        const groupCount = await db.get("SELECT COUNT(*) as count FROM groups_table");
        const reportCount = await db.get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'");

        const onlineIds = Array.from(new Set(onlineUsers.values()));
        let onlineDetails = [];
        if (onlineIds.length > 0) {
            const placeholders = onlineIds.map(() => '?').join(',');
            onlineDetails = await db.all(`SELECT id, name, image FROM users WHERE id IN (${placeholders})`, onlineIds);
        }

        res.json({
            users: userCount?.count || 0,
            messages: msgCount?.count || 0,
            groups: groupCount?.count || 0,
            reports: reportCount?.count || 0,
            activeNow: onlineIds.length,
            onlineUsers: onlineDetails
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Get All Users
app.get('/api/admin/users', async (req, res) => {
    try {
        // Fetch all users with safety fallbacks for columns that might be missing during migration
        const users = await db.all("SELECT * FROM users ORDER BY lastSeen DESC");

        // Map users to ensure all expected properties exist for the frontend
        const sanitizedUsers = users.map(u => ({
            id: u.id,
            name: u.name || 'Unknown User',
            phone: u.phone || 'N/A',
            image: u.image || '',
            isBanned: u.isBanned || 0,
            isVerified: u.isVerified || 0,
            isApproved: u.isApproved !== undefined ? u.isApproved : 1,
            deviceId: u.deviceId || null,
            lastSeen: u.lastSeen || u.timestamp || null,
            createdAt: u.createdAt || u.timestamp || new Date().toISOString()
        }));

        res.json(sanitizedUsers);
    } catch (err) {
        console.error('Admin Users API Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Ban/Unban User
app.post('/api/admin/users/:id/ban', async (req, res) => {
    try {
        const { ban } = req.body;
        await db.run("UPDATE users SET isBanned = ? WHERE id = ?", [ban ? 1 : 0, req.params.id]);
        res.json({ success: true, message: `User ${ban ? 'banned' : 'unbanned'} successfully` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Verify/Unverify User
app.post('/api/admin/users/:id/verify', async (req, res) => {
    try {
        const { verify } = req.body;
        await db.run("UPDATE users SET isVerified = ?, isApproved = 1 WHERE id = ?", [verify ? 1 : 0, req.params.id]);
        res.json({ success: true, message: `User ${verify ? 'verified' : 'unverified'} successfully` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Approve Pending User
app.post('/api/admin/users/:id/approve', async (req, res) => {
    try {
        const { approve } = req.body;
        await db.run("UPDATE users SET isApproved = ? WHERE id = ?", [approve ? 1 : 0, req.params.id]);
        res.json({ success: true, message: `User ${approve ? 'approved' : 'rejected'}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Broadcast Message to All Users
app.post('/api/admin/broadcast', async (req, res) => {
    try {
        const { message, adminId } = req.body;
        if (!message) return res.status(400).json({ error: "Message is required" });

        const users = await db.all("SELECT id FROM users");

        // Save to Database as SYSTEM messages for each user
        // This ensures it appears in their chat lists
        const timestamp = new Date().toISOString();
        const broadcastId = `bcast-${Date.now()}`;

        for (const user of users) {
            const chatId = user.id.includes('_') ? user.id : `SYSTEM_${user.id}`;
            const clientMsgId = `admin-bcast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            await db.run(
                "INSERT INTO messages (chatId, sender, text, type, status, client_msg_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [chatId, 'SYSTEM', message, 'text', 'sent', clientMsgId, timestamp]
            );
        }

        // Emit via Socket.IO
        io.emit('receive_message', {
            chatId: 'SYSTEM',
            sender: 'SYSTEM',
            senderName: 'Whatsup',
            text: message,
            type: 'text',
            timestamp: timestamp,
            isVerified: true
        });

        // Record in history
        await db.run("INSERT INTO broadcast_history (adminId, message, targetCount) VALUES (?, ?, ?)",
            [adminId || 'admin', message, users.length]);

        res.json({ success: true, targetCount: users.length });
    } catch (err) {
        console.error('Broadcast Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 6. Send Personal Warning/Message to User
app.post('/api/admin/users/:id/message', async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.params.id;
        const timestamp = new Date().toISOString();

        const chatId = `SYSTEM_${userId}`;
        const clientMsgId = `admin-msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await db.run(
            "INSERT INTO messages (chatId, sender, text, type, status, client_msg_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [chatId, 'SYSTEM', message, 'text', 'sent', clientMsgId, timestamp]
        );

        const msgPayload = {
            chatId: chatId,
            sender: 'SYSTEM',
            senderName: 'Whatsup',
            text: message,
            type: 'text',
            timestamp: timestamp,
            isVerified: true
        };

        // Broadcast to user rooms
        const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
        [userId, clean(userId)].forEach(r => io.to(r).emit('receive_message', msgPayload));

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6.5 Get User Activity (Messages Sent)
app.get('/api/admin/users/:id/activity', async (req, res) => {
    try {
        const userId = req.params.id;
        const messages = await db.all("SELECT * FROM messages WHERE sender = ? OR sender LIKE ? ORDER BY timestamp DESC LIMIT 100", [userId, `%${userId}`]);
        res.json(messages);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6.5// Get user by phone (Normalized)
app.get('/api/user/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const user = await db.get("SELECT * FROM users WHERE phone = ? OR phone LIKE ?", [phone, `%${phone}`]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Appeal/Review Request from Banned User
app.post('/api/users/review', async (req, res) => {
    try {
        const { userId, message } = req.body;
        await db.run("INSERT INTO ban_reviews (userId, message) VALUES (?, ?)", [userId, message]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: Get User Lifetime Stats
app.get('/api/admin/users/:id/stats', async (req, res) => {
    try {
        const uid = req.params.id;
        const msgs = await db.get("SELECT COUNT(*) as count FROM messages WHERE sender = ?", [uid]);
        const calls = await db.get("SELECT COUNT(*) as count, SUM(duration) as totalTime FROM calls WHERE callerId = ? OR receiverId = ?", [uid, uid]);
        const joinedGroups = await db.get("SELECT COUNT(*) as count FROM group_members WHERE userId = ?", [uid]);

        res.json({
            messagesSent: msgs.count || 0,
            callsHandled: calls.count || 0,
            callDuration: calls.totalTime || 0,
            groupsJoined: joinedGroups.count || 0
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6.6 Get Call Logs
app.get('/api/admin/calls', async (req, res) => {
    try {
        const calls = await db.all(`
            SELECT c.*, u1.name as callerName, u2.name as receiverName 
            FROM calls c
            LEFT JOIN users u1 ON c.callerId = u1.id
            LEFT JOIN users u2 ON c.receiverId = u2.id
            ORDER BY c.timestamp DESC
        `);
        res.json(calls);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Get All Reports
app.get('/api/admin/reports', async (req, res) => {
    try {
        const reports = await db.all(`
            SELECT r.*, u1.name as reporterName, u2.name as reportedName 
            FROM reports r
            LEFT JOIN users u1 ON r.reporterId = u1.id
            LEFT JOIN users u2 ON r.reportedId = u2.id
            ORDER BY r.createdAt DESC
        `);
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/debug-db', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ error: 'Database instance is null' });
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        const messages = await db.all("SELECT * FROM messages ORDER BY id DESC LIMIT 5");
        res.json({
            status: 'Database Connected',
            tables: tables,
            recent_messages: messages
        });
    } catch (e) {
        res.status(500).json({ error: e.message, stack: e.stack });
    }
});

initDB().then(database => {
    db = database;
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('❌ Database Initialization Failed:', err);
});

const otpStore = new Map();

app.post('/api/otp/send', async (req, res) => {
    // OTP no longer required
    res.json({ success: true, message: "OTP Bypassed", isTest: true });
});

app.post('/api/otp/verify', (req, res) => {
    // OTP no longer required
    return res.json({ success: true });
});

app.post('/api/users/register', async (req, res) => {
    let { id, name, phone, image, deviceId } = req.body;
    console.log('👤 [Register Request]', { id, name, phone, deviceId });

    if (!phone) return res.status(400).json({ error: "Phone number is required" });

    const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);

    try {
        // 1. Device Lock Check
        if (deviceId) {
            const deviceOwner = await db.get("SELECT phone FROM users WHERE deviceId = ?", [deviceId]);
            if (deviceOwner && deviceOwner.phone !== cleanPhone) {
                return res.status(403).json({
                    error: "Device Locked",
                    message: "Another account is already linked to this device. Please use your original number."
                });
            }
        }

        // 2. 1000 User Limit & Approval Check
        const existingUser = await db.get("SELECT * FROM users WHERE phone = ?", [cleanPhone]);
        let isApproved = 1;

        if (!existingUser) {
            const userCountRows = await db.get("SELECT COUNT(*) as count FROM users");
            if (userCountRows.count >= 1000) {
                isApproved = 0; // Needs admin approval if above 1000
                console.log(`⚠️ User Limit Reached (1000+). User ${cleanPhone} needs approval.`);
            }
        } else {
            // Maintain existing approval status (Don't auto-approve if they were pending)
            isApproved = existingUser.isApproved;
        }

        const isMySQL = db.constructor.name === 'MySQLWrapper';
        let query;

        if (isMySQL) {
            query = "INSERT INTO users (id, name, phone, image, deviceId, isApproved) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), phone=VALUES(phone), image=VALUES(image), deviceId=VALUES(deviceId), lastSeen=CURRENT_TIMESTAMP";
        } else {
            query = "INSERT INTO users (id, name, phone, image, deviceId, isApproved) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, image=excluded.image, deviceId=excluded.deviceId, lastSeen=CURRENT_TIMESTAMP";
        }

        await db.run(query, [id, name, cleanPhone, image, deviceId || null, isApproved]);

        io.emit('user_updated', { id, name, phone: cleanPhone, image, deviceId });

        console.log('✅ [Register Success] User saved:', id, 'Approved:', !!isApproved);
        res.status(200).json({
            success: true,
            isApproved: !!isApproved,
            message: isApproved ? "Welcome back!" : "Your account is pending admin approval."
        });
    } catch (err) {
        console.error('❌ [Register Error]', err);
        res.status(500).json({ error: "Database registration failed: " + err.message });
    }
});

app.get('/api/users/phone/:phone', async (req, res) => {
    const cleanPhone = req.params.phone.replace(/[^0-9]/g, '');
    try {
        const row = await db.get("SELECT * FROM users WHERE phone = ?", [cleanPhone]);
        if (row) res.status(200).json(row);
        else res.status(404).json({ error: "User not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get user details (for presence/last seen)
app.get('/api/user/:phone', async (req, res) => {
    const cleanPhone = req.params.phone.replace(/[^0-9]/g, '').slice(-10);
    try {
        const row = await db.get("SELECT id, phone, name, avatar, lastSeen FROM users WHERE phone LIKE ? OR id LIKE ?", [`%${cleanPhone}`, `%${cleanPhone}`]);
        if (row) res.status(200).json(row);
        else res.status(404).json({ error: "User not found" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// FCM Token Registration
app.post('/api/register-fcm-token', async (req, res) => {
    const { userId, token } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'Missing userId or token' });

    console.log(`🔥 Registering FCM Token for ${userId}: ${token.substring(0, 10)}...`);

    try {
        const cleanId = userId.replace(/\D/g, '').slice(-10);
        await db.run("UPDATE users SET fcmToken = ? WHERE id = ? OR phone LIKE ?", [token, userId, `%${cleanId}`]);
        res.json({ success: true, message: 'Token updated' });
    } catch (err) {
        // If column missing, try adding it on the fly
        if (String(err).includes('no such column') || String(err).includes('Unknown column')) {
            try {
                await db.run("ALTER TABLE users ADD COLUMN fcmToken TEXT");
                await db.run("UPDATE users SET fcmToken = ? WHERE id = ? OR phone LIKE ?", [token, userId, `%${cleanId}`]);
                return res.json({ success: true, message: 'Token updated (Schema Migrated)' });
            } catch (e) {
                console.error("FCM Migration Failed:", e);
            }
        }
        res.status(500).json({ error: err.message });
    }
});

// Multi-Device Registration API
app.post('/api/register-device', async (req, res) => {
    const { userId, token, deviceName, platform } = req.body;
    if (!userId || !token) return res.status(400).json({ error: 'Missing userId or token' });

    console.log(`📱 Registering device for ${userId}: ${(deviceName || 'Unknown')} (${platform || 'android'})`);

    try {
        const cleanId = userId.replace(/\D/g, '').slice(-10);
        const isMySQL = db.constructor.name === 'MySQLWrapper';
        const q = isMySQL
            ? "INSERT INTO user_devices (userId, token, deviceName, platform, lastActive) VALUES (?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE lastActive = NOW(), deviceName = VALUES(deviceName)"
            : "INSERT OR REPLACE INTO user_devices (userId, token, deviceName, platform, lastActive) VALUES (?, ?, ?, ?, datetime('now'))";
        await db.run(q, [userId, token, deviceName || 'Unknown', platform || 'android']);

        // Also update main users table for backward compatibility
        await db.run("UPDATE users SET fcmToken = ? WHERE id = ? OR phone LIKE ?", [token, userId, `%${cleanId}`]);

        res.json({ success: true, message: 'Device registered' });
    } catch (err) {
        console.error('Device registration error:', err);
        res.status(500).json({ error: err.message });
    }
});

// E2E APIs Removed

// Force Migration Endpoint
app.get('/api/migrate-fcm', async (req, res) => {
    try {
        await db.run("ALTER TABLE users ADD COLUMN fcmToken TEXT");
        res.json({ success: true, message: 'fcmToken column added' });
    } catch (err) {
        if (String(err).includes('Duplicate column')) {
            res.json({ success: true, message: 'Column already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

app.get('/api/messages/:chatId', async (req, res) => {
    try {
        let { chatId } = req.params;
        console.log(`🔎 [API] Messages Request Query:`, req.query); // DEBUG
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0;
        const beforeId = req.query.before; // Cursor ID

        const clean = (id) => id.toString().replace(/\D/g, '').slice(-10);
        let normChatId = chatId;
        if (chatId.includes('_')) {
            normChatId = chatId.split('_').map(clean).sort().join('_');
        }

        let query, params;
        if (beforeId) {
            // Cursor-based Pagination - embed LIMIT for MySQL2 compatibility
            query = `SELECT * FROM messages WHERE (chatId = ? OR chatId = ?) AND id < ? ORDER BY id DESC LIMIT ${parseInt(limit)}`;
            params = [chatId, normChatId, parseInt(beforeId)];
        } else {
            // Offset-based Pagination - embed LIMIT/OFFSET for MySQL2 compatibility
            query = `SELECT * FROM messages WHERE chatId = ? OR chatId = ? ORDER BY id DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
            params = [chatId, normChatId];
        }

        console.log(`[DEBUG] Executing Paged Query: ${query} Params: ${params}`);
        const rows = await db.all(query, params);

        if (!rows || !Array.isArray(rows)) {
            console.error("❌ [SERVER] Invalid DB rows:", rows);
            return res.status(200).json([]);
        }

        // Reverse to get chronological order (oldest first)
        // Parse reactions JSON for each message
        const messages = rows.reverse().map(msg => {
            let parsedReactions = [];
            try { parsedReactions = msg.reactions ? JSON.parse(msg.reactions) : []; } catch (e) { }

            let parsedReplyTo = null;
            try { parsedReplyTo = msg.replyTo ? JSON.parse(msg.replyTo) : null; } catch (e) { }

            return {
                ...msg,
                reactions: parsedReactions,
                replyTo: parsedReplyTo
            };
        });

        res.status(200).json(messages);
    } catch (err) {
        console.error("🔥 CRITICAL /api/messages ERROR:", err);
        res.status(500).json({ error: String(err), message: "Server Error Fetching Messages" });
    }
});

// ========== ONE-TIME MIGRATION ENDPOINT ==========
app.get('/api/migrate-reactions', async (req, res) => {
    try {
        await db.run("ALTER TABLE messages ADD COLUMN reactions TEXT");
        res.status(200).json({ success: true, message: 'reactions column added!' });
    } catch (err) {
        if (String(err).includes('Duplicate column') || String(err).includes('already exists')) {
            res.status(200).json({ success: true, message: 'reactions column already exists' });
        } else {
            res.status(500).json({ error: String(err) });
        }
    }
});

// ========== ONE-TIME MIGRATION ENDPOINT (Reply To) ==========
app.get('/api/migrate-replyTo', async (req, res) => {
    try {
        await db.run("ALTER TABLE messages ADD COLUMN replyTo TEXT");
        res.status(200).json({ success: true, message: 'replyTo column added!' });
    } catch (err) {
        if (String(err).includes('Duplicate column') || String(err).includes('already exists')) {
            res.status(200).json({ success: true, message: 'replyTo column already exists' });
        } else {
            res.status(500).json({ error: String(err) });
        }
    }
});


// JSON Fallback Logic

const emailFallbackPath = path.join(__dirname, 'emails_fallback.json');
const getEmailFallback = () => {
    try { return JSON.parse(fs.readFileSync(emailFallbackPath) || '{}'); } catch (e) { return {}; }
};
const setEmailFallback = (userId, email) => {
    try {
        const data = getEmailFallback();
        data[userId] = email;
        fs.writeFileSync(emailFallbackPath, JSON.stringify(data));
    } catch (e) { console.error('Fallback Write Error:', e); }
};

// Get Email Status
app.get('/api/user/:userId/email-status', async (req, res) => {
    try {
        const { userId } = req.params;
        const cleanId = userId.replace(/\D/g, '').slice(-10);

        let dbEmail = null;
        let dbVerified = false;

        try {
            const user = await db.get("SELECT email, email_verified FROM users WHERE id = ? OR phone LIKE ?", [userId, `%${cleanId}`]);
            if (user) {
                dbEmail = user.email;
                dbVerified = !!user.email_verified;
            }
        } catch (e) { console.error('DB Read Error:', e.message); }

        // Fallback Check
        const fallbackData = getEmailFallback();
        const fallbackEmail = fallbackData[userId];

        if (dbEmail && dbVerified) {
            res.json({ email: dbEmail, verified: dbVerified });
        } else if (fallbackEmail) {
            res.json({ email: fallbackEmail, verified: true });
        } else {
            res.json({ email: null, verified: false });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const emailOtpStore = new Map();

// Send Email OTP
app.post('/api/email/send-otp', async (req, res) => {
    const { userId, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Generate 6 digit code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    emailOtpStore.set(`${userId}_${email}`, otp);

    // In Production: Send via Nodemailer
    console.log(`📧 [EMAIL OTP] To: ${email}, Code: ${otp}`);

    res.json({ success: true, message: 'OTP Sent (Check Server Console)' });
});

// Verify Email OTP
app.post('/api/email/verify-otp', async (req, res) => {
    const { userId, email, otp } = req.body;
    const storedOtp = emailOtpStore.get(`${userId}_${email}`);

    // Allow mock 123456 for testing
    if ((storedOtp && storedOtp === otp) || otp === '123456') {
        // Verify in DB
        const cleanId = userId.replace(/\D/g, '').slice(-10);
        try {
            await db.run("UPDATE users SET email = ?, email_verified = 1 WHERE id = ? OR phone LIKE ?", [email, userId, `%${cleanId}`]);
        } catch (e) {
            console.error('DB Update Error:', e.message);
            // Continue to fallback
        }

        // Save to Fallback
        setEmailFallback(userId, email);

        emailOtpStore.delete(`${userId}_${email}`);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid or expired code' });
    }
});

// ========== REACTION API ==========
app.post('/api/messages/:messageId/reaction', async (req, res) => {
    try {
        const { messageId } = req.params;
        const { userId, emoji, userName } = req.body;

        if (!messageId || !userId || !emoji) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get current message
        const message = await db.get('SELECT * FROM messages WHERE id = ?', [parseInt(messageId)]);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        // Parse existing reactions
        let reactions = [];
        try {
            reactions = message.reactions ? JSON.parse(message.reactions) : [];
        } catch (e) {
            reactions = [];
        }

        // Check if user already reacted with same emoji
        const existingIdx = reactions.findIndex(r => r.userId === userId && r.emoji === emoji);

        if (existingIdx >= 0) {
            // Toggle off - remove reaction
            reactions.splice(existingIdx, 1);
        } else {
            // Add new reaction
            reactions.push({ userId, emoji, userName: userName || 'User' });
        }

        // Update database
        await db.run('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), parseInt(messageId)]);

        // Emit to socket for real-time update
        if (io) {
            io.emit('reaction-update', { messageId: parseInt(messageId), reactions });
        }

        res.status(200).json({ success: true, reactions });
    } catch (err) {
        console.error('Reaction API Error:', err);
        res.status(500).json({ error: String(err) });
    }
});

// ====== BLOCK USER APIs ======
app.get('/api/users/:userId/blocked', async (req, res) => {
    try {
        const cleanId = String(req.params.userId).replace(/\D/g, '').slice(-10);
        const blockedUsers = await db.all("SELECT blockedUserId FROM blocked_users WHERE userId = ?", [cleanId]);
        res.json(blockedUsers.map(b => b.blockedUserId));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/block', async (req, res) => {
    try {
        const { userId, blockedUserId, action } = req.body; // action: 'block' or 'unblock'
        const cleanUser = String(userId).replace(/\D/g, '').slice(-10);
        const cleanBlocked = String(blockedUserId).replace(/\D/g, '').slice(-10);
        
        if (action === 'unblock') {
            await db.run("DELETE FROM blocked_users WHERE userId = ? AND blockedUserId = ?", [cleanUser, cleanBlocked]);
        } else {
            const isMySQL = db.constructor.name === 'MySQLWrapper';
            const query = isMySQL ? 
                "INSERT IGNORE INTO blocked_users (userId, blockedUserId) VALUES (?, ?)" :
                "INSERT OR IGNORE INTO blocked_users (userId, blockedUserId) VALUES (?, ?)";
            await db.run(query, [cleanUser, cleanBlocked]);
        }
        res.json({ success: true, blockedUserId: cleanBlocked, action });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// ==============================

app.get('/api/chats/:userId', async (req, res) => {
    const rawUserId = req.params.userId;
    const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
    const cleanId = clean(rawUserId);

    try {
        const uniqueChats = [];
        const deletedRows = await db.all("SELECT chatId FROM deleted_chats WHERE userId = ?", [cleanId]);
        const dbDeletedIds = new Set(deletedRows.map(r => String(r.chatId)));

        // 1. Groups
        const groups = await db.all(
            `SELECT DISTINCT g.* FROM groups_table g 
             JOIN group_members gm ON g.id = gm.groupId 
             WHERE gm.userId LIKE ? OR gm.userId LIKE ? OR gm.userId = ?`,
            [`%${cleanId}`, `%${cleanId}%`, rawUserId]
        );

        for (const g of groups) {
            if (dbDeletedIds.has(String(g.id))) continue;

            const isMySQL = db.constructor.name === 'MySQLWrapper';
            const lastMsg = await db.get("SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp DESC LIMIT 1", [g.id]);
            const memberQuery = isMySQL
                ? `SELECT gm.userId as id, gm.role, u.name FROM group_members gm LEFT JOIN users u ON gm.userId = u.id OR gm.userId = u.phone OR gm.userId LIKE CONCAT('%', u.phone) WHERE gm.groupId = ?`
                : `SELECT gm.userId as id, gm.role, u.name FROM group_members gm LEFT JOIN users u ON gm.userId = u.id OR gm.userId = u.phone OR gm.userId LIKE '%' || u.phone WHERE gm.groupId = ?`;

            const members = await db.all(memberQuery, [g.id]);

            // 🛡️ SERVER-SIDE FIX: Auto-detect type for groups too
            let grpType = lastMsg ? lastMsg.type : 'text';
            let grpPreview = lastMsg ? (lastMsg.text || 'Media') : 'Tap to chat';
            if (lastMsg && lastMsg.mediaUrl) {
                const grpMediaUrl = (lastMsg.mediaUrl || '').toLowerCase();
                if (grpMediaUrl.match(/\.(mp4|webm|mov|avi|mkv|3gp|wmv|flv|m4v)(\?.*)?$/)) {
                    grpType = 'video';
                    if (!lastMsg.text || lastMsg.text === 'Media') grpPreview = 'Video';
                } else if (grpMediaUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/)) {
                    grpType = 'image';
                    if (!lastMsg.text || lastMsg.text === 'Media') grpPreview = 'Photo';
                }
            }

            uniqueChats.push({
                id: g.id, name: g.name, isGroup: true,
                members: members.map(m => ({ id: m.id, isAdmin: m.role === 'admin' })),
                lastMessage: grpPreview,
                lastMessageType: grpType,
                mediaUrl: lastMsg ? lastMsg.mediaUrl : null,
                time: lastMsg ? lastMsg.timestamp : (g.createdAt || new Date().toISOString()),
                unread: 0, avatar: g.icon, type: g.type
            });
        }

        // 2. Private Chats
        const rawMessages = await db.all(
            "SELECT * FROM messages WHERE (chatId LIKE ? OR chatId LIKE ?) AND (deleted_by IS NULL OR deleted_by NOT LIKE ?)",
            [`%${cleanId}%`, `%${cleanId}%`, `%${cleanId}%`]
        );
        const seenChats = new Set();
        uniqueChats.forEach(c => seenChats.add(c.id));

        rawMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        for (const msg of rawMessages) {
            if (!msg.chatId || !String(msg.chatId).includes('_')) continue;
            const cleanParts = String(msg.chatId).split('_').map(clean).sort();
            const normCid = cleanParts.join('_');

            if (dbDeletedIds.has(normCid) || seenChats.has(normCid)) continue;

            const otherId = cleanParts.find(id => id !== cleanId);
            if (!otherId || otherId.length < 5) continue;

            seenChats.add(normCid);
            // Lookup user by ID OR Phone (handles local vs global IDs)
            const user = await db.get("SELECT name, image, phone FROM users WHERE id = ? OR phone LIKE ? OR phone LIKE ?", [otherId, `%${otherId}`, otherId]);

            // 🛡️ SERVER-SIDE FIX: ALWAYS detect correct type from mediaUrl (ignore DB type)
            let detectedType = msg.type;
            const mediaUrlLower = (msg.mediaUrl || '').toLowerCase();
            // 🔥 BULLETPROOF: Always override type based on actual file extension
            if (mediaUrlLower) {
                if (mediaUrlLower.match(/\.(mp4|webm|mov|avi|mkv|3gp|wmv|flv|m4v)(\?.*)?$/)) {
                    detectedType = 'video';
                } else if (mediaUrlLower.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/)) {
                    detectedType = 'image';
                } else if (mediaUrlLower.match(/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/)) {
                    detectedType = 'audio';
                }
            }

            // Generate correct preview text
            let previewText = msg.text;
            if (!previewText || previewText === 'Media') {
                if (detectedType === 'video') previewText = 'Video';
                else if (detectedType === 'image') previewText = 'Photo';
                else if (detectedType === 'audio') previewText = 'Audio';
                else if (msg.mediaUrl) previewText = 'Media';
            }

            uniqueChats.push({
                id: normCid,
                name: user ? user.name : otherId,
                avatar: user ? user.image : `https://ui-avatars.com/api/?name=${otherId}&background=random`,
                phone: user ? user.phone : otherId,
                lastMessage: previewText,
                lastMessageType: detectedType || msg.type || 'text',
                mediaUrl: msg.mediaUrl, // 🔧 Include mediaUrl for client-side detection
                time: msg.timestamp,
                unread: 0,
                isGroup: false
            });
        }

        // 3. From Calls (for people who called but no messages yet)
        const calls = await db.all(
            "SELECT DISTINCT CASE WHEN callerId = ? THEN receiverId ELSE callerId END as otherId, timestamp FROM calls WHERE callerId = ? OR receiverId = ? ORDER BY timestamp DESC LIMIT 20",
            [rawUserId, rawUserId, rawUserId]
        );
        for (const c of calls) {
            const otherId = c.otherId;
            const otherClean = clean(otherId);
            const normCid = [cleanId, otherClean].sort().join('_');
            if (seenChats.has(normCid) || dbDeletedIds.has(normCid)) continue;

            seenChats.add(normCid);
            const user = await db.get("SELECT name, image, phone FROM users WHERE id = ? OR phone LIKE ? OR phone LIKE ?", [otherId, `%${otherClean}`, otherId]);
            uniqueChats.push({
                id: normCid,
                name: user ? user.name : otherId,
                avatar: user ? user.image : `https://ui-avatars.com/api/?name=${otherId}&background=random`,
                phone: user ? user.phone : otherId,
                lastMessage: 'Voice call',
                time: c.timestamp,
                unread: 0,
                isGroup: false
            });
        }

        uniqueChats.sort((a, b) => new Date(b.time) - new Date(a.time));
        res.status(200).json(uniqueChats);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Local Storage (No Cloudinary)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Unique filename: timestamp-random.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// File Upload Endpoint - Cloudinary
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        console.log('📤 Uploading to Cloudinary:', req.file.originalname);

        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'wavechat',
            resource_type: 'auto'
        });

        console.log('✅ Cloudinary upload successful:', result.secure_url);

        // Delete local file after upload
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            url: result.secure_url,
            public_id: result.public_id,
            resource_type: result.resource_type
        });
    } catch (err) {
        console.error('❌ Cloudinary upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// More APIs
app.get('/api/groups/:id', async (req, res) => {
    try {
        const group = await db.get("SELECT * FROM groups_table WHERE id = ?", [req.params.id]);
        if (!group) return res.status(404).json({ error: "Group not found" });

        const isMySQL = db.constructor.name === 'MySQLWrapper';
        const memberQuery = isMySQL
            ? `SELECT gm.userId as id, gm.role, u.name, u.image as avatar FROM group_members gm LEFT JOIN users u ON gm.userId = u.id OR gm.userId = u.phone OR gm.userId LIKE CONCAT('%', u.phone) WHERE gm.groupId = ?`
            : `SELECT gm.userId as id, gm.role, u.name, u.image as avatar FROM group_members gm LEFT JOIN users u ON gm.userId = u.id OR gm.userId = u.phone OR gm.userId LIKE '%' || u.phone WHERE gm.groupId = ?`;

        const members = await db.all(memberQuery, [req.params.id]);
        res.json({ ...group, avatar: group.icon, members });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/groups/:id/messages', async (req, res) => {
    try {
        const msgs = await db.all("SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC", [req.params.id]);
        res.json(msgs);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/groups/:id/members/:userId/permission', async (req, res) => {
    try {
        const { canSend } = req.body;
        const { id, userId } = req.params;
        const clean = (idx) => String(idx).replace(/\D/g, '').slice(-10);
        const cleanUser = clean(userId);
        await db.run("UPDATE group_members SET canSend = ? WHERE groupId = ? AND (userId = ? OR userId = ?)", [canSend, id, cleanUser, `+${cleanUser}`]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/status', async (req, res) => {
    const { userId, userName, type, content, bgColor, mediaUrl } = req.body;
    const isMySQL = db.constructor.name === 'MySQLWrapper';
    // MySQL format: YYYY-MM-DD HH:MM:SS
    const expiresAt = isMySQL
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    console.log('📸 Status POST:', { userId, userName, type, contentLength: content?.length });

    try {
        const result = await db.run("INSERT INTO status (userId, userName, type, content, bgColor, mediaUrl, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)", [userId, userName, type, content, bgColor, mediaUrl, expiresAt]);
        const newStatus = { id: result.lastID, userId, userName, type, content, bgColor, mediaUrl, expiresAt, timestamp: new Date().toISOString() };
        io.emit('new_status', newStatus);
        console.log('✅ Status created:', result.lastID);
        res.status(200).json({ success: true, status: newStatus });
    } catch (err) {
        console.error('❌ Status creation error:', err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        const isMySQL = db.constructor.name === 'MySQLWrapper';
        const nowFn = isMySQL ? 'NOW()' : "datetime('now')";
        const rows = await db.all(`SELECT s.*, u.image as avatar FROM status s LEFT JOIN users u ON s.userId = u.id WHERE s.expiresAt > ${nowFn} OR s.expiresAt > ? ORDER BY s.timestamp DESC`, [new Date().toISOString()]);
        res.status(200).json(rows);
    } catch (err) { res.status(500).json([]); }
});

// Group Creation API
app.post('/api/groups', async (req, res) => {
    const { name, image, members, createdBy } = req.body;
    try {
        console.log('📝 Creating group:', { name, members: members?.length, createdBy });

        // Create group - FIXED: Use correct table name and capture ID
        const gid = `g-${Date.now()}`;
        await db.run(
            "INSERT INTO groups_table (id, name, icon, createdBy) VALUES (?, ?, ?, ?)",
            [gid, name, image || null, createdBy]
        );
        const groupId = gid;

        // Add members
        const memberPromises = members.map(memberId => {
            const role = memberId === createdBy ? 'admin' : 'member';
            return db.run(
                "INSERT INTO group_members (groupId, userId, role, canSend) VALUES (?, ?, ?, ?)",
                [groupId, memberId, role, 1]
            );
        });
        await Promise.all(memberPromises);

        const newGroup = {
            id: groupId,
            name,
            avatar: image, // Match ChatList expectation
            unread: 0,
            lastMessage: 'Tap to chat',
            time: new Date().toISOString(),
            isGroup: true,
            createdBy,
            members,
            timestamp: new Date().toISOString()
        };

        console.log('✅ Group created:', groupId);

        // Broadcast to all members
        members.forEach(memberId => {
            const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
            const mClean = clean(memberId);

            // Emit to all possible variations of the ID/Phone
            [memberId, mClean, `+${mClean}`].forEach(room => {
                io.to(room).emit('new_group_created', newGroup);
            });

            // Force join the room for online members immediately
            const sockets = Array.from(io.sockets.sockets.values());
            const userSockets = sockets.filter(s => s.rooms.has(memberId) || s.rooms.has(mClean) || s.rooms.has(`+${mClean}`));
            userSockets.forEach(s => s.join(groupId));
        });

        res.status(200).json({ success: true, group: newGroup });
    } catch (err) {
        console.error('❌ Group creation error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 🌐 SPA CATCH-ALL: Serve index.html for any unknown routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CALL CLEANUP: Mark stale 'ringing' calls as 'missed' ---
const cleanupStaleCalls = async () => {
    if (!db) return;
    try {
        // Mark ringing calls older than 5 minutes as missed
        await db.run("UPDATE calls SET status = 'missed' WHERE status = 'ringing' AND timestamp < datetime('now', '-5 minutes')");
        // Mark connected calls older than 4 hours as completed (safety)
        await db.run("UPDATE calls SET status = 'completed' WHERE status = 'connected' AND timestamp < datetime('now', '-4 hours')");
        console.log('🧹 [Cleanup] Stale calls cleaned up');
    } catch (e) { console.error('Cleanup error:', e); }
};

// Initial cleanup and periodic interval (every 10 minutes)
setTimeout(() => {
    cleanupStaleCalls();
    setInterval(cleanupStaleCalls, 600000);
}, 5000);

// Socket.IO
const onlineUsers = new Map(); // socket.id → userId

// Helper: Reverse lookup — find socket.id by userId
// onlineUsers stores socket.id→userId, so we iterate to find userId→socket.id
function getSocketIdByUserId(targetUserId) {
    if (!targetUserId) return null;
    const cleanTarget = String(targetUserId).replace(/\D/g, '').slice(-10);
    for (const [socketId, userId] of onlineUsers.entries()) {
        if (String(userId) === String(targetUserId)) return socketId;
        const cleanUserId = String(userId).replace(/\D/g, '').slice(-10);
        if (cleanUserId === cleanTarget) return socketId;
    }
    return null;
}

io.on('connection', (socket) => {
    socket.on('join_chat', (id) => socket.join(id));

    socket.on('register', (userId) => {
        if (!userId) return;
        const normalized = userId.toString().replace(/\D/g, '').slice(-10);
        socket.join(userId);
        socket.join(normalized);
        // Initially register as online
        onlineUsers.set(socket.id, userId);
        io.emit('online_users', Array.from(new Set(onlineUsers.values())));
        db.all("SELECT groupId FROM group_members WHERE userId = ? OR userId = ? OR userId LIKE ?", [userId, normalized, `%${normalized}`])
            .then(gs => gs.forEach(g => {
                console.log(`🔌 User ${userId} joined Group Room: ${g.groupId}`);
                socket.join(g.groupId);
            }))
            .catch(() => { });
    });

    socket.on('set_active_status', ({ userId, status }) => {
        if (status === 'offline') {
            onlineUsers.delete(socket.id);
            const now = new Date();
            const iso = now.toISOString();
            const mysql = iso.slice(0, 19).replace('T', ' ');
            io.emit('last_seen_sync', { userId, lastSeen: iso });
            db.run("UPDATE users SET lastSeen = ? WHERE id = ?", [mysql, userId]).catch(() => { });
        } else {
            onlineUsers.set(socket.id, userId);
        }
        io.emit('online_users', Array.from(new Set(onlineUsers.values())));
    });

    socket.on('get_online_users', () => {
        socket.emit('online_users', Array.from(new Set(onlineUsers.values())));
    });

    socket.on('send_message', async (data) => {
        const { chatId, sender, text, type, mediaUrl, replyTo } = data; // Extract replyTo

        // 🔍 DEBUG: Log what type is being received
        console.log(`📩 [SEND_MESSAGE] Received message:`, {
            chatId,
            sender,
            text: text ? text.substring(0, 50) : null,
            type: type,
            hasMediaUrl: !!mediaUrl,
            mediaUrl: mediaUrl ? mediaUrl.substring(0, 80) : null,
            replyTo: !!replyTo
        });

        const clean = (id) => id.toString().replace(/\D/g, '').slice(-10);
        let normChatId = String(chatId).includes('_') ? String(chatId).split('_').map(clean).sort().join('_') : String(chatId);

        try {
            const isMySQL = db.constructor.name === 'MySQLWrapper';

            // 🛑 BLOCK CHECK
            // Find who the receiver is if it's a 1-to-1 chat
            if (String(chatId).includes('_')) {
                const parts = String(chatId).split('_');
                const senderClean = clean(sender);
                const other = parts.find(p => clean(p) !== senderClean) || parts.find(p => p !== sender);
                if (other) {
                    const otherClean = clean(other);
                    const isBlocked = await db.get("SELECT id FROM blocked_users WHERE userId = ? AND blockedUserId = ?", [otherClean, senderClean]);
                    if (isBlocked) {
                        console.log(`🚫 [BLOCK] Message dropped! ${senderClean} is blocked by ${otherClean}`);
                        // Fake ack so sender sees 1 tick
                        socket.emit('message_ack', { tempId: data.id, realId: data.id, status: 'sent', chatId: normChatId });
                        return; // Stop execution
                    }
                }
            }
            let actualId;
            const replyToString = replyTo ? JSON.stringify(replyTo) : null; // Stringify for storage

            if (data.id && !String(data.id).startsWith('local-')) {
                const query = isMySQL
                    ? `INSERT INTO messages (chatId, sender, text, type, mediaUrl, client_msg_id, replyTo) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE text=VALUES(text)`
                    : `INSERT OR REPLACE INTO messages (chatId, sender, text, type, mediaUrl, client_msg_id, replyTo) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                const result = await db.run(query, [normChatId, sender, text || null, type || 'text', mediaUrl || null, data.id, replyToString]);
                actualId = result.lastID;

                // If it was a duplicate, result.lastID might be 0. Fetch the real ID.
                if (!actualId || actualId === 0) {
                    const existing = await db.get("SELECT id FROM messages WHERE client_msg_id = ?", [data.id]);
                    if (existing) actualId = existing.id;
                }
            } else {
                const result = await db.run("INSERT INTO messages (chatId, sender, text, type, mediaUrl, status, replyTo) VALUES (?, ?, ?, ?, ?, ?, ?)", [normChatId, sender, text || null, type || 'text', mediaUrl || null, 'sent', replyToString]);
                actualId = result.lastID;
            }

            socket.emit('message_ack', { tempId: data.id, realId: actualId, status: 'sent', chatId: normChatId });
            const msg = { ...data, id: actualId || data.id, tempId: data.id, chatId: normChatId, status: 'sent', timestamp: new Date().toISOString() };

            // 🔥 CHAT LIST PREVIEW UPDATE - Generate preview data
            let previewText = text || 'Media';
            if (type === 'image') previewText = '📷 Photo';
            else if (type === 'video') previewText = '🎥 Video';
            else if (type === 'audio') previewText = '🎵 Audio';
            else if (type === 'document') previewText = '📄 Document';

            const chatListUpdate = {
                chatId: normChatId,
                lastMessage: previewText,
                lastMessageType: type || 'text',
                mediaUrl: mediaUrl || null,
                timestamp: msg.timestamp,
                senderId: sender,
                senderName: data.senderName || 'User'
            };

            if (String(chatId).includes('_')) {
                const parts = String(chatId).split('_');
                const senderClean = clean(sender);
                // Fix: Compare cleaned IDs to find the OTHER user correctly
                const other = parts.find(p => clean(p) !== senderClean) || parts.find(p => p !== sender);
                const rooms = new Set([chatId, other, clean(other), sender, senderClean].filter(Boolean));
                let emitter = io;
                rooms.forEach(r => emitter = emitter.to(r));
                emitter.emit('receive_message', msg);

                // 🔥 EMIT CHAT LIST UPDATE to both users
                emitter.emit('chat_list_update', chatListUpdate);
                console.log('📋 [SERVER] Chat list update emitted:', chatListUpdate.lastMessage);

                // 🔔 PUSH NOTIFICATION for background/killed app
                if (other) {
                    try {
                        const otherClean = clean(other);
                        console.log(`🔔 [PUSH] Looking for receiver token. Other: ${other}, OtherClean: ${otherClean}, Sender: ${sender}`);
                        // Try to find receiver's FCM token
                        const receiver = await db.get(
                            "SELECT fcmToken, name FROM users WHERE id = ? OR phone LIKE ? OR phone LIKE ?",
                            [other, `%${otherClean}`, otherClean]
                        );

                        if (receiver && receiver.fcmToken) {
                            const senderUser = await db.get("SELECT name FROM users WHERE id = ? OR phone LIKE ?", [sender, `%${senderClean}`]);
                            const senderName = senderUser?.name || data.senderName || 'Someone';

                            console.log(`🔔 [PUSH] Sending message push to ${other} from ${senderName}`);
                            await sendPushNotification(
                                receiver.fcmToken,
                                senderName,
                                previewText,
                                { chatId: normChatId, type: 'message', senderId: sender }
                            );
                        } else {
                            console.log('⏭️ No FCM token for receiver:', other, 'DB result:', JSON.stringify(receiver));
                        }
                    } catch (pushErr) {
                        console.error('❌ Push notification error:', pushErr.message);
                    }
                }
            } else {
                io.to(chatId).emit('receive_message', msg);
                io.to(chatId).emit('chat_list_update', chatListUpdate);
                const members = await db.all("SELECT userId FROM group_members WHERE groupId = ?", [chatId]);
                members.forEach(m => {
                    io.to(m.userId).emit('receive_message', msg);
                    io.to(m.userId).emit('chat_list_update', chatListUpdate);
                });

                // 🔔 PUSH NOTIFICATION for group members (background/killed app)
                try {
                    const group = await db.get("SELECT name FROM groups_table WHERE id = ?", [chatId]);
                    const groupName = group?.name || 'Group';
                    const senderUser = await db.get("SELECT name FROM users WHERE id = ? OR phone LIKE ?", [sender, `%${clean(sender)}`]);
                    const senderName = senderUser?.name || data.senderName || 'Someone';

                    for (const member of members) {
                        // Skip sender
                        if (String(member.userId) === String(sender) || clean(member.userId) === clean(sender)) continue;

                        const user = await db.get("SELECT fcmToken FROM users WHERE id = ? OR phone LIKE ?", [member.userId, `%${clean(member.userId)}`]);
                        if (user?.fcmToken) {
                            await sendPushNotification(
                                user.fcmToken,
                                `${senderName} @ ${groupName}`,
                                previewText,
                                { chatId: chatId, type: 'group_message', senderId: sender }
                            );
                        }
                    }
                } catch (groupPushErr) {
                    console.error('❌ Group push notification error:', groupPushErr.message);
                }
            }
        } catch (err) { console.error(err); }
    });

    socket.on('delete_chat', async (chatId) => {
        try {
            const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
            const userIdClean = clean(userId);
            let normChatId = String(chatId).includes('_') ? String(chatId).split('_').map(clean).sort().join('_') : String(chatId);

            // Insert or replace into deleted_chats table
            const isMySQL = db.constructor.name === 'MySQLWrapper';
            const query = isMySQL
                ? "INSERT IGNORE INTO deleted_chats (userId, chatId) VALUES (?, ?)"
                : "INSERT OR IGNORE INTO deleted_chats (userId, chatId) VALUES (?, ?)";
            
            await db.run(query, [userIdClean, normChatId]);
            console.log(`🗑️ [SERVER] User ${userIdClean} deleted chat ${normChatId}`);
        } catch (err) {
            console.error('❌ Delete chat error:', err.message);
        }
    });

    socket.on('mark_read', async ({ chatId, readerId }) => {
        console.log('👁 [SERVER] SEEN EVENT RECEIVED - Chat:', chatId, 'Reader:', readerId);

        const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
        const readerClean = clean(readerId);

        // Normalize Chat ID to ensure DB update works regardless of ID order
        let normChatId = String(chatId).includes('_') ? String(chatId).split('_').map(clean).sort().join('_') : String(chatId);

        try {
            // 🛠 FINAL FIX: Use LIKE to match sender containing the last 10 digits
            // ChatId format: "phone1_phone2" (normalized to last 10 digits)
            const parts = String(normChatId).split('_');

            let totalUpdated = 0;
            for (const p of parts) {
                const pClean = clean(p);
                // Skip if this part is the reader
                if (pClean === readerClean) continue;

                // Update messages where sender CONTAINS these 10 digits (handles all formats)
                const result = await db.run(
                    `UPDATE messages SET status='read' 
                     WHERE (chatId = ? OR chatId = ?) 
                     AND status != 'read'
                     AND sender LIKE ?`,
                    [chatId, normChatId, `%${pClean}%`]
                );
                totalUpdated += result.changes || 0;
                console.log(`📖 [SERVER] Trying sender pattern %${pClean}%: ${result.changes || 0} updated`);
            }
            console.log(`📖 [SERVER] DB Updated: ${totalUpdated} messages marked as READ`);

            // BROADCAST to the entire chat room
            io.to(chatId).emit('messages_read_update', { chatId, readerId, status: 'read' });
            io.to(normChatId).emit('messages_read_update', { chatId: normChatId, readerId, status: 'read' });

            // 🛡️ SILVER BULLET: Direct Socket Emit (USER'S BLUEPRINT PATTERN)
            const chatParts = String(normChatId).split('_');
            chatParts.forEach(p => {
                const pClean = clean(p);
                if (pClean !== readerClean) {
                    const senderId = pClean; // This is the SENDER who needs blue tick
                    console.log(`🔍 [SERVER] Looking for SENDER socket: ${senderId}`);

                    let found = false;
                    for (const [sid, uid] of onlineUsers.entries()) {
                        if (clean(uid) === senderId) {
                            io.to(sid).emit('messages_read_update', { chatId: normChatId, readerId, status: 'read' });
                            console.log(`📤 [SERVER] ✅ SEEN SENT TO SENDER (Socket: ${sid}, User: ${uid})`);
                            found = true;
                        }
                    }

                    if (!found) {
                        console.log(`⚠️ [SERVER] Sender ${senderId} NOT ONLINE - Blue tick will update when they reconnect`);
                    }
                }
            });
        } catch (e) { console.error("❌ Mark Read Error:", e); }
    });

    socket.on('mark_delivered', async ({ chatId, messageId, senderId }) => {
        console.log(`📡 [SERVER] Received mark_delivered: Msg=${messageId}, Sender=${senderId}`);
        try {
            // Support updating by ID (Database Integer) OR Client Message ID (String)
            let query = "UPDATE messages SET status='delivered' WHERE (id = ? OR client_msg_id = ?) AND status = 'sent'";
            await db.run(query, [messageId, messageId]);

            // If we don't have the real ID yet, fetch it for the broadcast
            let actualId = messageId;
            if (isNaN(messageId)) {
                const existing = await db.get("SELECT id FROM messages WHERE client_msg_id = ?", [messageId]);
                if (existing) actualId = existing.id;
            }

            // BROADCAST to the entire chat room
            io.to(chatId).emit('message_delivered', { messageId: actualId, id: actualId, chatId, status: 'delivered' });

            // ALSO emit to sender specifically via all possible room names
            if (senderId) {
                const sClean = String(senderId).replace(/\D/g, '').slice(-10);

                // 1. Emit to Rooms (Standard)
                [senderId, sClean, '+' + sClean].forEach(room => {
                    io.to(room).emit('message_delivered', { messageId: actualId, id: actualId, chatId, status: 'delivered' });
                });

                // 2. Emit to Exact Socket (Iterate Online Users)
                // This guarantees delivery if user is connected
                for (const [sid, uid] of onlineUsers.entries()) {
                    const uClean = String(uid).replace(/\D/g, '').slice(-10);
                    if (uClean === sClean) {
                        io.to(sid).emit('message_delivered', { messageId: actualId, id: actualId, chatId, status: 'delivered' });
                        console.log(`🎯 [SERVER] Direct Delivery Emit to Socket: ${sid} (User: ${uid})`);
                    }
                }
            }
        } catch (e) { console.error("Mark Delivered Error:", e); }
    });

    socket.on('delete_chat', async (chatId) => {
        const userId = onlineUsers.get(socket.id);
        const clean = (id) => String(id).replace(/\D/g, '').slice(-10);
        const normCid = String(chatId).includes('_') ? chatId.split('_').map(clean).sort().join('_') : chatId;
        try {
            if (userId) {
                const isMySQL = db.constructor.name === 'MySQLWrapper';
                const q = isMySQL ? "INSERT IGNORE INTO deleted_chats (userId, chatId) VALUES (?, ?)" : "INSERT OR IGNORE INTO deleted_chats (userId, chatId) VALUES (?, ?)";
                await db.run(q, [userId, normCid]);
                const msgs = await db.all("SELECT id, deleted_by FROM messages WHERE chatId = ?", [normCid]);
                for (const m of msgs) {
                    let d = m.deleted_by || '';
                    if (!d.includes(userId)) await db.run("UPDATE messages SET deleted_by = ? WHERE id = ?", [d ? `${d},${userId}` : userId, m.id]);
                }
                socket.emit('chat_deleted', { chatId });
            }
        } catch (e) { }
    });

    // NOTE: call_user is now handled below with call_waiting + multi-device support (Phase 4)

    socket.on('call_accepted', (data) => {
        const { callerId, receiverId } = data;
        const cleanCaller = String(callerId).replace(/\D/g, '').slice(-10);

        // Smart Routing: Send to Caller's specific socket
        const callerSocketId = getSocketIdByUserId(callerId);

        if (callerSocketId) {
            console.log(`✅ [Accepted] Sending signal to Caller ${callerId} at socket ${callerSocketId}`);
            io.to(callerSocketId).emit('call_accepted', data);
        } else {
            // Fallback to room if map missing (redundancy)
            [cleanCaller, callerId].forEach(r => socket.to(r).emit('call_accepted', data));
        }

        // Update database status to 'connected'
        try {
            db.run("UPDATE calls SET status = 'connected' WHERE callerId = ? AND receiverId = ? AND status IN ('missed', 'ringing') ORDER BY timestamp DESC LIMIT 1",
                [callerId, receiverId]);
        } catch (e) { }
    });

    socket.on('reject_call', async ({ callerId, receiverId, reason }) => {
        const cleanCaller = String(callerId).replace(/\D/g, '').slice(-10);
        // Notify the original caller that the call was rejected (excluding current sender)
        [cleanCaller, callerId].forEach(r => socket.to(r).emit('call_rejected', { reason }));

        // Update log
        try {
            await db.run("UPDATE calls SET status = 'rejected' WHERE callerId = ? AND receiverId = ? AND status = 'missed' ORDER BY timestamp DESC LIMIT 1",
                [callerId, receiverId]);
        } catch (e) { }
    });

    socket.on('end_call', async ({ notifyId, callerId, receiverId, duration }) => {
        const cleanNotify = String(notifyId).replace(/\D/g, '').slice(-10);
        // Notify the other party that call ended (excluding current sender)
        [cleanNotify, notifyId].forEach(r => socket.to(r).emit('call_ended'));

        // Update log to completed
        try {
            await db.run("UPDATE calls SET status = 'completed', duration = ? WHERE callerId = ? AND receiverId = ? AND status IN ('missed', 'connected') ORDER BY timestamp DESC LIMIT 1",
                [duration || 0, callerId, receiverId]);
        } catch (e) { }
    });

    // ========================
    // PHASE 3: GROUP CALLING
    // ========================
    socket.on('group_call_user', async (data) => {
        // data = { callerId, callerName, groupId, groupName, memberIds: [...], type: 'audio'|'video', roomId }
        const { callerId, callerName, groupId, groupName, memberIds, type, roomId } = data;
        console.log(`📞 [Group Call] ${callerName} calling group ${groupName} with ${memberIds?.length} members`);

        if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) return;

        try {
            // Log call in DB
            const result = await db.run(
                "INSERT INTO calls (callerId, receiverId, type, status, isGroupCall, roomId) VALUES (?, ?, ?, ?, 1, ?)",
                [callerId, groupId, type || 'audio', 'ringing', roomId]
            );
            const callId = result.lastID;

            // Add all members as participants
            for (const memberId of memberIds) {
                if (String(memberId) === String(callerId)) continue; // Skip caller
                await db.run(
                    "INSERT INTO group_call_participants (callId, userId, status) VALUES (?, ?, 'ringing')",
                    [callId, memberId]
                );
            }

            // Notify all members via socket + FCM
            for (const memberId of memberIds) {
                if (String(memberId) === String(callerId)) continue;

                const cleanMember = String(memberId).replace(/\D/g, '').slice(-10);
                const callData = {
                    ...data,
                    callId,
                    isGroupCall: true,
                    callerName: callerName || 'Someone'
                };

                // Socket notification (excluding sender)
                [cleanMember, memberId, '+' + cleanMember].forEach(r =>
                    socket.to(r).emit('incoming_call', callData)
                );

                // FCM Push notification
                try {
                    // Multi-device: try all tokens
                    const devices = await db.all(
                        "SELECT token FROM user_devices WHERE userId = ? OR userId LIKE ?",
                        [memberId, `%${cleanMember}`]
                    ).catch(() => []);

                    // Fallback: single token from users table
                    if (!devices || devices.length === 0) {
                        const user = await db.get(
                            "SELECT fcmToken FROM users WHERE id = ? OR phone LIKE ?",
                            [memberId, `%${cleanMember}`]
                        );
                        if (user?.fcmToken) {
                            await sendPushNotification(
                                user.fcmToken,
                                `Group ${type || 'Voice'} Call`,
                                `${callerName} is calling ${groupName}...`,
                                {
                                    type: 'call_offer',
                                    callerId, callerName,
                                    callType: type || 'audio',
                                    channelId: roomId || '',
                                    isGroupCall: 'true',
                                    groupId, groupName,
                                    description: 'Incoming Group Call'
                                }
                            );
                        }
                    } else {
                        // Multi-device: send to ALL registered devices
                        for (const device of devices) {
                            await sendPushNotification(
                                device.token,
                                `Group ${type || 'Voice'} Call`,
                                `${callerName} is calling ${groupName}...`,
                                {
                                    type: 'call_offer',
                                    callerId, callerName,
                                    callType: type || 'audio',
                                    channelId: roomId || '',
                                    isGroupCall: 'true',
                                    groupId, groupName,
                                    description: 'Incoming Group Call'
                                }
                            );
                        }
                    }
                } catch (pushErr) {
                    console.error(`Push failed for member ${memberId}:`, pushErr.message);
                }
            }
        } catch (e) {
            console.error('Group call error:', e);
        }
    });

    // ========================
    // PHASE 4A: CALL WAITING
    // ========================
    socket.on('call_user', async (data) => {
        const cleanTo = String(data.receiverId).replace(/\D/g, '').slice(-10);
        const callId = `${data.callerId}_${Date.now()}`;

        try {
            // 1. Busy check (FIX: Reduced ringing window from 5min to 30sec to prevent stale entries blocking calls)
            const activeCall = await db.get(
                `SELECT * FROM calls 
                 WHERE (callerId = ? OR receiverId = ?) 
                 AND (
                    (status = 'connected' AND timestamp > datetime('now', '-4 hours')) OR 
                    (status = 'ringing' AND timestamp > datetime('now', '-30 seconds'))
                 ) 
                 ORDER BY timestamp DESC LIMIT 1`,
                [data.receiverId, data.receiverId]
            );

            if (activeCall) {
                console.log(`📞 [Call Waiting] ${data.receiverId} is busy`);
                socket.emit('user_busy', {
                    receiverId: data.receiverId,
                    receiverName: data.receiverName || 'User',
                    message: 'User is on another call'
                });

                // Send call_waiting signal
                const rooms = new Set([cleanTo, data.receiverId, '+' + cleanTo]);
                rooms.forEach(r => socket.to(r).emit('call_waiting', { ...data, callId }));

                // FCM call_waiting (FIX: sendCallNotification was UNDEFINED — using sendPushNotification)
                try {
                    const waitUser = await db.get("SELECT fcmToken FROM users WHERE id = ? OR phone LIKE ?", [data.receiverId, `%${cleanTo}`]);
                    if (waitUser?.fcmToken) {
                        await sendPushNotification(waitUser.fcmToken, `${data.callerName || 'Someone'} is calling`, 'Incoming call', {
                            type: 'call_waiting', callId, callerId: String(data.callerId), callerName: data.callerName || 'Someone', callType: data.callType || 'audio'
                        });
                    }
                } catch (fcmErr) { console.error('FCM call_waiting error:', fcmErr); }
                return;
            }

            // 2. Normal Call Flow
            const receiverSocketId = getSocketIdByUserId(data.receiverId);
            const payload = { ...data, callId, from: socket.id };

            // Log the call
            await db.run("INSERT INTO calls (callerId, receiverId, type, status) VALUES (?, ?, ?, ?)",
                [data.callerId, data.receiverId, data.callType || 'audio', 'ringing']);

            // Signal via Socket if online
            if (receiverSocketId) {
                console.log(`✅ [Smart Route] User ${data.receiverId} is ONLINE.`);
                io.to(receiverSocketId).emit('incoming_call', payload);
            }
            
            // 🛡️ [Room Fallback] Always emit to ID rooms for better reliability
            const rooms = new Set([cleanTo, data.receiverId, '+' + cleanTo]);
            rooms.forEach(room => {
                socket.to(room).emit('incoming_call', payload);
            });
            console.log(`📡 [Broadcasting] Call signal sent to Rooms: ${Array.from(rooms).join(', ')}`);

            // 3. FCM Wake-up (FIX: sendCallNotification was UNDEFINED — using sendPushNotification)
            try {
                const callReceiver = await db.get("SELECT fcmToken FROM users WHERE id = ? OR phone LIKE ?", [data.receiverId, `%${cleanTo}`]);
                if (callReceiver?.fcmToken) {
                    await sendPushNotification(callReceiver.fcmToken, `${data.callerName || 'Someone'} is calling`, 'Incoming call', {
                        type: 'call_offer', callId, callerId: String(data.callerId), callerName: data.callerName || 'Someone', callType: data.callType || 'audio'
                    });
                    console.log(`📱 [FCM] Call notification sent to ${data.receiverId}`);
                } else {
                    console.log(`⚠️ [FCM] No FCM token for ${data.receiverId} — relying on Socket only`);
                }
            } catch (fcmErr) { console.error('FCM call_offer error:', fcmErr); }

        } catch (e) {
            console.error('📞 call_user error:', e);
        }
    });

    // FIX GAP 5: Update call status when answered
    socket.on('answer_call', async ({ callerId, receiverId }) => {
        try {
            const cleanCaller = String(callerId).replace(/\D/g, '').slice(-10);
            const cleanReceiver = String(receiverId).replace(/\D/g, '').slice(-10);
            await db.run(
                "UPDATE calls SET status = 'connected' WHERE status IN ('ringing', 'missed') AND ((callerId = ? OR callerId LIKE ?) AND (receiverId = ? OR receiverId LIKE ?)) ORDER BY timestamp DESC LIMIT 1",
                [callerId, `%${cleanCaller}`, receiverId, `%${cleanReceiver}`]
            );
            console.log(`📞 [Answer] Call ${callerId} → ${receiverId} status updated to connected`);
        } catch (e) { console.error('answer_call error:', e); }
    });

    // FIX GAP 4 + P3: End current call and answer waiting call
    socket.on('end_and_answer', async ({ currentCallerId, waitingCallerId, userId }) => {
        try {
            const cleanUser = String(userId).replace(/\D/g, '').slice(-10);
            const cleanCurrent = String(currentCallerId).replace(/\D/g, '').slice(-10);
            const cleanWaiting = String(waitingCallerId).replace(/\D/g, '').slice(-10);

            // 1. End current call
            await db.run(
                "UPDATE calls SET status = 'completed' WHERE status = 'connected' AND ((callerId = ? OR callerId LIKE ?) OR (receiverId = ? OR receiverId LIKE ?)) ORDER BY timestamp DESC LIMIT 1",
                [currentCallerId, `%${cleanCurrent}`, currentCallerId, `%${cleanCurrent}`]
            );

            // Notify the other person that call ended (excluding sender)
            [cleanCurrent, currentCallerId, '+' + cleanCurrent].forEach(r => socket.to(r).emit('call_ended'));

            // 2. Answer waiting call
            await db.run(
                "UPDATE calls SET status = 'connected' WHERE status = 'missed' AND callerId = ? AND (receiverId = ? OR receiverId LIKE ?) ORDER BY timestamp DESC LIMIT 1",
                [waitingCallerId, userId, `%${cleanUser}`]
            );

            // Notify waiting caller that call is accepted (excluding sender)
            [cleanWaiting, waitingCallerId, '+' + cleanWaiting].forEach(r => socket.to(r).emit('call_accepted', {
                receiverId: userId,
                channelId: `${waitingCallerId}_${userId}_${Date.now()}`
            }));

            console.log(`📞 [End & Answer] ${userId} ended call with ${currentCallerId}, answered ${waitingCallerId}`);
        } catch (e) { console.error('end_and_answer error:', e); }
    });

    // Decline waiting call
    socket.on('decline_waiting', async ({ callerId, receiverId }) => {
        const cleanCaller = String(callerId).replace(/\D/g, '').slice(-10);
        [cleanCaller, callerId, '+' + cleanCaller].forEach(r => socket.to(r).emit('call_declined', {
            receiverId: receiverId,
            message: 'Call declined'
        }));
        console.log(`📞 [Decline Waiting] ${receiverId} declined waiting call from ${callerId}`);
    });

    socket.on('typing', ({ chatId, userId }) => {
        socket.to(chatId).emit('typing', { chatId, userId });
    });

    socket.on('stop_typing', ({ chatId, userId }) => {
        socket.to(chatId).emit('stop_typing', { chatId, userId });
    });

    socket.on('delete_message', async ({ chatId, messageId, forEveryone }) => {
        try {
            if (forEveryone) {
                await db.run("DELETE FROM messages WHERE id = ?", [messageId]);
                io.to(chatId).emit('message_deleted', { chatId, messageId });
            }
        } catch (e) { console.error(e); }
    });

    socket.on('disconnect', async () => {
        const userId = onlineUsers.get(socket.id);
        if (userId) {
            onlineUsers.delete(socket.id);
            const now = new Date();
            const iso = now.toISOString();

            // 🔧 RESTART/DISCONNECT PROTECTION: Auto-end calls if socket dies with 15s grace period
            setTimeout(async () => {
                try {
                    // Check if user is STILL offline (not re-joined with new socket)
                    const isStillOffline = !Array.from(onlineUsers.values()).includes(userId);
                    if (!isStillOffline) return;

                    // Find active calls where this user was a participant
                    const activeCall = await db.get(
                        "SELECT * FROM calls WHERE (callerId = ? OR receiverId = ?) AND status IN ('ringing', 'missed', 'connected') ORDER BY timestamp DESC LIMIT 1",
                        [userId, userId]
                    );

                    if (activeCall) {
                        const peerId = activeCall.callerId === userId ? activeCall.receiverId : activeCall.callerId;
                        const cleanPeer = String(peerId).replace(/\D/g, '').slice(-10);

                        console.log(`🔌 [Server] Participant ${userId} still offline after grace period. Ending call with ${peerId}`);

                        // Notify peer to close UI
                        [cleanPeer, peerId].forEach(r => socket.to(r).emit('call_ended'));

                        // Update DB status
                        await db.run("UPDATE calls SET status = 'completed' WHERE id = ?", [activeCall.id]);
                    }
                } catch (err) {
                    console.error("Disconnect call cleanup error:", err);
                }
            }, 15000); // 15s grace period for reconnects

            const mysql = iso.slice(0, 19).replace('T', ' ');
            io.emit('online_users', Array.from(new Set(onlineUsers.values())));
            io.emit('last_seen_sync', { userId, lastSeen: iso });
            db.run("UPDATE users SET lastSeen = ? WHERE id = ?", [mysql, userId]).catch(() => { });
        }
    });
});
