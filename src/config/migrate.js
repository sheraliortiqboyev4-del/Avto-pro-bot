/** Eski SQLite bazaga yangi ustunlarni qo'shish (sequelize.sync ALTER qilmaydi) */
const USER_COLUMNS = [
    { name: 'coins', def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'referrerChatId', def: 'BIGINT' },
    { name: 'referralEligible', def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'referralToken', def: 'VARCHAR(255)' },
    { name: 'referralTokenExpiresAt', def: 'DATETIME' },
    { name: 'coinRedemptions', def: 'INTEGER NOT NULL DEFAULT 0' }
];

const getTableColumns = async (tableName) => {
    const { sequelize } = require('./db');
    const [rows] = await sequelize.query(`PRAGMA table_info(\`${tableName}\`)`);
    return rows.map((r) => r.name);
};

const migrateUsersTable = async () => {
    const { sequelize } = require('./db');
    let existing;
    try {
        existing = await getTableColumns('users');
    } catch (e) {
        return false;
    }
    if (existing.length === 0) return false;

    let changed = false;
    for (const { name, def } of USER_COLUMNS) {
        if (existing.includes(name)) continue;
        await sequelize.query(`ALTER TABLE \`users\` ADD COLUMN \`${name}\` ${def}`);
        console.log(`✅ Migration: users.${name} qo'shildi`);
        existing.push(name);
        changed = true;
    }

    if (existing.includes('referralToken')) {
        try {
            await sequelize.query(
                'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_token ON users(referralToken) WHERE referralToken IS NOT NULL'
            );
        } catch (e) {
            // indeks allaqachon bo'lishi mumkin
        }
    }

    return changed;
};

const migrateSchema = async () => {
    await migrateUsersTable();
};

const isMissingColumnError = (err) => {
    const msg = err?.message || err?.parent?.message || '';
    return msg.includes('no such column');
};

module.exports = { migrateSchema, migrateUsersTable, isMissingColumnError };
