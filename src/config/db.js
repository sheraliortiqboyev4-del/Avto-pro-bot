const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '../../database.sqlite'),
    logging: false
});

let dbReady = false;

const setDbReady = (ready) => {
    dbReady = !!ready;
};

const getDbReady = () => dbReady;

const loadModels = () => {
    require('../models/User');
    require('../models/Channel');
    require('../models/PremiumAd');
};

const connectDB = async () => {
    loadModels();
    await sequelize.authenticate();
    console.log('✅ SQLite ulanishi muvaffaqiyatli.');
    await sequelize.sync();
    console.log('✅ Ma\'lumotlar bazasi sinxronizatsiya qilindi.');
    setDbReady(true);
};

const reconnectDB = async () => {
    setDbReady(false);
    try {
        await sequelize.close();
    } catch (e) {
        // allaqachon yopilgan bo'lishi mumkin
    }
    await connectDB();
};

const ensureSchema = async () => {
    loadModels();
    await sequelize.sync();
};

module.exports = { sequelize, connectDB, reconnectDB, ensureSchema, setDbReady, getDbReady };
