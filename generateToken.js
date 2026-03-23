/**
 * Google Drive OAuth Token Generator
 * Run this script once to generate refresh token
 * Command: node generateToken.js
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', 'oauth-credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', 'drive-token.json');

async function generateToken() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const { client_id, client_secret, redirect_uris } = credentials.installed;

    const oauth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        'http://localhost:3000/oauth2callback'
    );

    // Generate auth URL
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'],
        prompt: 'consent'
    });

    console.log('\n🔗 Open this URL in your browser:\n');
    console.log(authUrl);
    console.log('\n⏳ Waiting for authorization...\n');

    // Create local server to receive callback
    const server = http.createServer(async (req, res) => {
        const queryObject = url.parse(req.url, true).query;

        if (queryObject.code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>✅ Authorization successful! You can close this window.</h1>');

            try {
                const { tokens } = await oauth2Client.getToken(queryObject.code);

                // Save tokens
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

                console.log('✅ Token saved to:', TOKEN_PATH);
                console.log('\n🎉 Setup complete! You can now upload to Google Drive.\n');

                server.close();
                process.exit(0);
            } catch (error) {
                console.error('❌ Error getting tokens:', error.message);
                server.close();
                process.exit(1);
            }
        }
    });

    server.listen(3000, () => {
        console.log('🌐 Callback server running on http://localhost:3000');
    });
}

generateToken();
