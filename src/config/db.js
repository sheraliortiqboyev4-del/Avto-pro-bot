const { Sequelize } = require('sequelize');
const config = require('./index');
const { connectMongoDB } = require('./mongodb');

const sequelize = new Sequelize(config.databaseUrl, {
    dialect: 'postgres',
    logging: false, // Konsolda SQL so'rovlarni ko'rsatmaslik uchun
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false // Render kabi platformalar uchun kerak
        }
    }
});

const connectDB = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ PostgreSQL ulanishi muvaffaqiyatli.');
        
        // Modelarni sinxronizatsiya qilish (tablelarni yaratish)
        await sequelize.sync({ alter: true });
        console.log('✅ Ma\'lumotlar bazasi sinxronizatsiya qilindi.');
        
        // MongoDB'ga ulanish
        await connectMongoDB();
    } catch (error) {
        console.error('❌ PostgreSQL ulanishida xato:', error.message);
        // Qayta urinish
        setTimeout(connectDB, 5000);
    }
};

module.exports = { sequelize, connectDB };
