const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '../../database.sqlite'),
    logging: false
});

const connectDB = async () => {
    await sequelize.authenticate();
    console.log('✅ SQLite ulanishi muvaffaqiyatli.');
    await sequelize.sync();
    console.log('✅ Ma\'lumotlar bazasi sinxronizatsiya qilindi.');
};

const reconnectDB = async () => {
    try {
        await sequelize.close();
    } catch (e) {
        // allaqachon yopilgan bo'lishi mumkin
    }
    await connectDB();
};

module.exports = { sequelize, connectDB, reconnectDB };
