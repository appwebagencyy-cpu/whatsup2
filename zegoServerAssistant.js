"use strict";
// Zego Server Assistant - Token Generation Utility
// Source: Zego Cloud Official Node.js Sample

const crypto = require('crypto');

function makeNonce() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function makeRandomIv() {
    const str = '0123456789abcdefghijklmnopqrstuvwxyz';
    const result = [];
    for (let i = 0; i < 16; i++) {
        const r = Math.floor(Math.random() * str.length);
        result.push(str.charAt(r));
    }
    return result.join('');
}

function getAlgorithm(keyBase64) {
    const key = Buffer.from(keyBase64);
    switch (key.length) {
        case 16:
            return 'aes-128-cbc';
        case 24:
            return 'aes-192-cbc';
        case 32:
            return 'aes-256-cbc';
    }
    throw new Error('Invalid key length: ' + key.length);
}

function aesEncrypt(plainText, key, iv) {
    const cipher = crypto.createCipheriv(getAlgorithm(key), key, iv);
    cipher.setAutoPadding(true);
    const encrypted = cipher.update(plainText);
    const final = cipher.final();
    return Buffer.concat([encrypted, final]);
}

/**
 * Generate Zego Token (Version 04)
 * @param {number} appId - Your Zego AppID
 * @param {string} userId - User ID
 * @param {string} serverSecret - Your Server Secret (32 chars)
 * @param {number} effectiveTimeInSeconds - Token validity duration (e.g., 3600)
 * @param {string} payload - Optional payload (json string or empty)
 * @returns {string} The generated token
 */
function generateToken04(appId, userId, serverSecret, effectiveTimeInSeconds, payload) {
    if (!appId || !userId || !serverSecret) {
        throw new Error('Missing required parameters for token generation');
    }

    const createTime = Math.floor(new Date().getTime() / 1000);
    const tokenInfo = {
        app_id: appId,
        user_id: userId,
        nonce: makeNonce(),
        ctime: createTime,
        expire: createTime + effectiveTimeInSeconds,
        payload: payload || ''
    };

    // Serialize JSON
    const plainText = JSON.stringify(tokenInfo);

    // Prepare IV (16 bytes random string)
    const iv = makeRandomIv();

    // Encrypt
    const encryptBuf = aesEncrypt(plainText, serverSecret, iv);

    // Pack: [Version(8 bytes) | IV(16 bytes on device) | EncryptedLength(2 bytes) | EncryptedData]
    // Note: Zego V04 format is: 
    // 04 (big endian int64 - 8 bytes) ??? No, V04 is simpler struct buffer. 
    // Let's follow standard implementation structure:

    // 1. Random 16 bytes IV
    // 2. Encrypt TokenInfo JSON using AES-CBC with ServerSecret (32 bytes)
    // 3. Format: [8 bytes expire time] [2 bytes IV length] [IV] [2 bytes data length] [Encrypted Data] 
    // Wait, the official sample packs differently. Let's use the standard "04" generic logic.

    // Standard V04 Packing Structure based on official repo:
    const b1 = new Uint8Array(8);
    const b2 = new Uint8Array(2);
    const b3 = new Uint8Array(2);

    // expiry time (Big Endian long - 64 bit) - but passed as part of plaintext too?
    // Actually the return format is: "04" + Base64(BinaryPacked)

    // Binary Packed:
    // [CreateTime (64bit BE)] [Expire (64bit BE)] [IV Len (16bit BE)] [IV] [Data Len (16bit BE)] [Data]

    // Let's use a simpler known working buffer construction
    const len_iv = iv.length;
    const len_data = encryptBuf.length;

    // Total Length = 8 + 2 + len_iv + 2 + len_data
    // Version is implicit in handling or prefixed? 
    // Official Docs say: "04" + base64 ...

    const buffer = Buffer.alloc(8 + 2 + len_iv + 2 + len_data);

    // Expire Time (Big Endian) - Note: standard JS uses Int32 for bitwise, so use BigInt or DataView
    // Actually, checking Zego logic, they pack 'expire' as 64-bit Big-Endian at start
    const bigExpire = BigInt(tokenInfo.expire);
    buffer.writeBigInt64BE(bigExpire, 0);

    // IV Length
    buffer.writeUInt16BE(len_iv, 8);

    // IV
    buffer.write(iv, 10);

    // Data Length
    buffer.writeUInt16BE(len_data, 10 + len_iv);

    // Data
    const dataOffset = 10 + len_iv + 2;
    encryptBuf.copy(buffer, dataOffset);

    return '04' + buffer.toString('base64');
}

module.exports = {
    generateToken04
};
