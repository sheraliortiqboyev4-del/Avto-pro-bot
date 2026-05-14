const fs = require('fs');
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
require('dotenv').config();

const DB_PATH = path.join(__dirname, 'database.sqlite');
const BACKUP_FILENAME = 'avtobot_db_backup.sqlite';

const run = async () => {
    try {
        console.log('📤 Checking database file...');
        if (!fs.existsSync(DB_PATH)) {
            console.log('❌ Database file not found!');
            return;
        }

        console.log('📤 Connecting to Telegram...');
        const client = new TelegramClient(
            new StringSession(process.env.ADMIN_SESSION),
            parseInt(process.env.API_ID) || 2040,
            process.env.API_HASH || "b18441a1ff607e10a989891a5462e627",
            { connectionRetries: 5 }
        );

        await client.connect();
        console.log('✅ Connected to Telegram!');

        console.log('📤 Uploading backup to Saved Messages...');
        await client.sendFile('me', {
            file: DB_PATH,
            caption: `🤖 AvtoBot Pro Database Backup\n📅 ${new Date().toLocaleString()}`,
            attributes: [
                new Api.DocumentAttributeFilename({ fileName: BACKUP_FILENAME })
            ]
        });

        console.log('✅ Backup uploaded to Saved Messages!');
        await client.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        console.error(error.stack);
    }
};

run();
