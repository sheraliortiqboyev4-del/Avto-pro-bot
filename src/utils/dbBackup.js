const fs = require('fs');
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('../config');
const User = require('../models/User');
const { sequelize } = require('../config/db');

const DB_PATH = path.join(__dirname, '../../database.sqlite');
const BACKUP_FILENAME = 'avtobot_db_backup.sqlite';

let backupClient = null;

const initBackupClient = async () => {
    if (!config.adminId || !config.apiId || !config.apiHash) {
        console.log('⚠️ Backup client not initialized (missing admin credentials)');
        return null;
    }

    if (backupClient) return backupClient;

    try {
        let adminSession = process.env.ADMIN_SESSION;
        
        // If no session from env, try to get from DB
        if (!adminSession) {
            try {
                await sequelize.authenticate();
                const adminUser = await User.findOne({ where: { chatId: config.adminId } });
                if (adminUser && adminUser.session) {
                    adminSession = adminUser.session;
                }
            } catch (e) {
                console.log('⚠️ Could not get admin session from DB (DB might not exist yet)');
            }
        }

        if (!adminSession) {
            console.log('⚠️ Backup client not initialized (no admin session found in env or DB)');
            return null;
        }

        backupClient = new TelegramClient(
            new StringSession(adminSession),
            config.apiId,
            config.apiHash,
            {
                connectionRetries: 5,
                requestRetries: 3,
                timeout: 60000,
                autoReconnect: true
            }
        );
        await backupClient.connect();
        console.log('✅ Backup client connected');
        return backupClient;
    } catch (error) {
        console.error('❌ Backup client connection error:', error.message);
        return null;
    }
};

const findBackupMessage = async (client) => {
    try {
        const me = await client.getMe();
        const messages = await client.getMessages('me', { limit: 50 });
        
        for (const msg of messages) {
            if (msg.document && msg.document.attributes) {
                for (const attr of msg.document.attributes) {
                    if (attr.fileName === BACKUP_FILENAME) {
                        return msg;
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.error('❌ Find backup message error:', error.message);
        return null;
    }
};

const restoreDB = async () => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            console.log('📥 Database file not found, trying to restore from backup...');
            
            const client = await initBackupClient();
            if (!client) {
                console.log('⚠️ No backup client available');
                return false;
            }

            const backupMsg = await findBackupMessage(client);
            if (!backupMsg) {
                console.log('⚠️ No backup found in Saved Messages');
                return false;
            }

            console.log('📥 Downloading backup from Saved Messages...');
            const buffer = await client.downloadMedia(backupMsg.document);
            fs.writeFileSync(DB_PATH, buffer);
            console.log('✅ Database restored successfully from backup!');
            return true;
        }
        return false;
    } catch (error) {
        console.error('❌ Restore database error:', error.message);
        return false;
    }
};

const backupDB = async () => {
    try {
        console.log(`📤 Checking DB for backup: ${DB_PATH}`);
        if (!fs.existsSync(DB_PATH)) {
            console.log('⚠️ Database file not found for backup');
            return false;
        }

        const stats = fs.statSync(DB_PATH);
        console.log(`📤 DB size for backup: ${stats.size} bytes`);

        const client = await initBackupClient();
        if (!client) {
            console.log('⚠️ No backup client available');
            return false;
        }

        console.log('📤 Uploading backup to Saved Messages...');
        
        const oldBackup = await findBackupMessage(client);
        if (oldBackup) {
            try {
                await client.deleteMessages('me', [oldBackup.id]);
                console.log('🗑 Old backup deleted');
            } catch (e) {
                console.error('🗑 Error deleting old backup:', e.message);
            }
        }

        await client.sendFile('me', {
            file: DB_PATH,
            caption: `🤖 AvtoBot Pro Database Backup\n📅 ${new Date().toLocaleString()}`,
            attributes: [
                new Api.DocumentAttributeFilename({ fileName: BACKUP_FILENAME })
            ]
        });

        console.log('✅ Database backed up to Saved Messages!');
        return true;
    } catch (error) {
        console.error('❌ Backup database error:', error.message);
        console.error(error.stack);
        return false;
    }
};

module.exports = { restoreDB, backupDB };
