const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '../../database.sqlite'),
    logging: false
});

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ SQLite ulanishi muvaffaqiyatli.');
        
        await sequelize.sync();
        console.log('✅ Ma\'lumotlar bazasi sinxronizatsiya qilindi.');
    } catch (error) {
        console.error('❌ SQLite ulanishida xato:', error.message);
        setTimeout(connectDB, 5000);
    }
};

module.exports = { sequelize, connectDB };
