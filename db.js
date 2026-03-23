const mysql = require('mysql2/promise');
require('dotenv').config();

let pool;

// Wrapper class to mimic SQLite API for MySQL
class MySQLWrapper {
    constructor(pool) {
        this.pool = pool;
    }

    async exec(sql) {
        // Handle multiple statements if needed, or just execute
        return await this.pool.query(sql);
    }

    async run(sql, params = []) {
        // Ensure params are clean (no undefined)
        const cleanParams = params.map(p => p === undefined ? null : p);
        try {
            const [result] = await this.pool.execute(sql, cleanParams);
            return {
                lastID: result.insertId,
                changes: result.affectedRows
            };
        } catch (e) {
            console.error('MySQL Execute Error:', e.message, 'SQL:', sql, 'Params:', cleanParams);
            throw e;
        }
    }

    async get(sql, params = []) {
        // Use query instead of execute for better compatibility (LIMIT/OFFSET handling)
        const [rows] = await this.pool.query(sql, params);
        return rows[0];
    }

    async all(sql, params = []) {
        const [rows] = await this.pool.query(sql, params);
        return rows;
    }
}

async function initDB() {
    // Check if MySQL credentials are provided
    if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
        console.log('🔌 Connecting to Hostinger MySQL Database...');
        try {
            pool = mysql.createPool({
                host: process.env.DB_HOST,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0,
                multipleStatements: true, // Allow multiple queries in exec
                connectTimeout: 10000 // 10s timeout
            });

            // Verify connection strictly before proceeding
            const connection = await pool.getConnection(); // Try to get a connection
            await connection.ping(); // Ping to ensure it's alive
            connection.release(); // Release it back

            const db = new MySQLWrapper(pool);
            console.log('✅ Connected to Hostinger MySQL Database (Verified)!');

            // Create Tables (MySQL syntax compatible)
            // Note: INT PRIMARY KEY AUTO_INCREMENT is slightly different from SQLite INTEGER PRIMARY KEY AUTOINCREMENT
            // But we will use IF NOT EXISTS
            await createTables(db);

            return db;
        } catch (err) {
            console.error('❌ MySQL Connection Failed:', err.message);
            console.log('⚠️ Falling back to Local SQLite...'); // Explicit fallback log
        }
    }

    // Fallback to SQLite if MySQL fails or variables missing
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    const path = require('path');
    const fs = require('fs');

    let dbPath = process.env.DB_PATH || path.join(__dirname, 'wavechat.db');

    // 🕒 FAILSAFE: If directory doesn't exist (e.g. /data on Render), create it or fallback to current dir
    const dbDir = path.dirname(dbPath);
    try {
        if (!fs.existsSync(dbDir)) {
            console.log(`📂 Creating database directory: ${dbDir}`);
            fs.mkdirSync(dbDir, { recursive: true });
        }
    } catch (e) {
        console.warn(`⚠️ Could not create dir ${dbDir}. Falling back to LOCAL current directory.`);
        dbPath = path.join(__dirname, 'wavechat.db');
    }

    console.log(`📂 Using Local SQLite Database at: ${dbPath}`);
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await createTables(db);
    return db;
}

// Helper to create tables (Works for both mostly, but adjustments might be needed for AUTO_INCREMENT)
async function createTables(db) {
    const isMySQL = db instanceof MySQLWrapper;
    const autoInc = isMySQL ? 'AUTO_INCREMENT' : 'AUTOINCREMENT';
    const primaryKey = isMySQL ? `INT PRIMARY KEY ${autoInc}` : 'INTEGER PRIMARY KEY AUTOINCREMENT';

    // Safe VARCHAR length for keys (191 * 4 = 764 < 767 bytes limit for older MySQL/MariaDB)
    const keyType = isMySQL ? 'VARCHAR(191)' : 'VARCHAR(255)';

    console.log('🛠️ Creating tables...');

    try {
        // Users
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id ${keyType} PRIMARY KEY,
                name TEXT,
                phone VARCHAR(255) UNIQUE,
                image TEXT,
                deviceId VARCHAR(255),
                lastSeen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                isBanned TINYINT(1) DEFAULT 0,
                isVerified TINYINT(1) DEFAULT 0,
                isApproved TINYINT(1) DEFAULT 1,
                role ${isMySQL ? "ENUM('user', 'admin') DEFAULT 'user'" : "VARCHAR(50) DEFAULT 'user'"},
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                fcmToken TEXT
            );
        `);
        console.log('✅ Table verified: users');

        // Messages
        await db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id ${primaryKey},
                chatId VARCHAR(255),
                sender VARCHAR(255),
                text TEXT,
                type VARCHAR(50),
                mediaUrl TEXT,
                status VARCHAR(50) DEFAULT 'delivered',
                client_msg_id VARCHAR(255) UNIQUE,
                deleted_by TEXT,
                replyTo TEXT,
                reactions TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table verified: messages');

        // Status
        await db.exec(`
             CREATE TABLE IF NOT EXISTS status (
                id ${primaryKey},
                userId VARCHAR(255),
                userName TEXT,
                type VARCHAR(50),
                content TEXT,
                bgColor VARCHAR(50),
                mediaUrl TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expiresAt DATETIME
            );
        `);
        console.log('✅ Table verified: status');

        // Groups
        await db.exec(`
            CREATE TABLE IF NOT EXISTS groups_table (
                id ${keyType} PRIMARY KEY,
                name TEXT,
                icon TEXT,
                description TEXT,
                createdBy VARCHAR(255),
                admins TEXT, -- JSON array of admin IDs
                type VARCHAR(50) DEFAULT 'public',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table verified: groups_table');

        // Group Members
        await db.exec(`
            CREATE TABLE IF NOT EXISTS group_members (
                id ${primaryKey},
                groupId VARCHAR(255),
                userId VARCHAR(255),
                role VARCHAR(50) DEFAULT 'member',
                canSend INT DEFAULT 1,
                joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table verified: group_members');

        // Status interactions
        await db.exec(`
            CREATE TABLE IF NOT EXISTS status_views (
                id ${primaryKey},
                statusId VARCHAR(255),
                userId VARCHAR(255),
                userName TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(statusId, userId)
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS status_likes (
                id ${primaryKey},
                statusId VARCHAR(255),
                userId VARCHAR(255),
                userName TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(statusId, userId)
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS status_comments (
                id ${primaryKey},
                statusId VARCHAR(255),
                userId VARCHAR(255),
                userName TEXT,
                content TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table verified: status interactions');

        // Admin & Moderation
        await db.exec(`
            CREATE TABLE IF NOT EXISTS reports (
                id ${primaryKey},
                reporterId VARCHAR(255),
                reportedId VARCHAR(255),
                reason TEXT,
                status ${isMySQL ? "ENUM('pending', 'resolved') DEFAULT 'pending'" : "VARCHAR(50) DEFAULT 'pending'"},
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS broadcast_history (
                id ${primaryKey},
                adminId VARCHAR(255),
                message TEXT,
                targetCount INT,
                sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS deleted_chats (
                id ${primaryKey},
                userId VARCHAR(255),
                chatId VARCHAR(255),
                UNIQUE(userId, chatId)
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS calls (
                id ${primaryKey},
                callerId VARCHAR(255),
                receiverId VARCHAR(255),
                type VARCHAR(50) DEFAULT 'audio',
                status VARCHAR(50) DEFAULT 'missed',
                duration INT DEFAULT 0,
                isGroupCall TINYINT(1) DEFAULT 0,
                roomId VARCHAR(255),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS group_call_participants (
                id ${primaryKey},
                callId INT,
                userId VARCHAR(255),
                status VARCHAR(50) DEFAULT 'ringing',
                joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await db.exec(`
            CREATE TABLE IF NOT EXISTS ban_reviews (
                id ${primaryKey},
                userId VARCHAR(255),
                message TEXT,
                status VARCHAR(50) DEFAULT 'pending',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table verified: admin & calls');

        // Multi-Device Support
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_devices (
                id ${primaryKey},
                userId VARCHAR(255),
                token TEXT,
                deviceName VARCHAR(255),
                platform VARCHAR(50) DEFAULT 'android',
                lastActive TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(userId, token)
            );
        `);

        // E2E Encryption
        await db.exec(`
            CREATE TABLE IF NOT EXISTS encryption_keys (
                userId ${keyType} PRIMARY KEY,
                publicKey TEXT,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Table verified: encryption_keys');

    } catch (err) {
        console.error('❌ Table Creation Failed:', err.message);
    }
}

module.exports = { initDB, getDB: () => pool ? new MySQLWrapper(pool) : require('sqlite').open() };
