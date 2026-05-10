const { Sequelize } = require('sequelize');
const config = require('./index');
const { connectMongoDB } = require('./mongodb');

let sequelize;

if (config.databaseUrl) {
    sequelize = new Sequelize(config.databaseUrl, {
        dialect: 'postgres',
        logging: false,
        dialectOptions: {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        }
    });
}

const connectDB = async () => {
    try {
        if (config.databaseUrl && sequelize) {
            await sequelize.authenticate();
            console.log('✅ PostgreSQL ulanishi muvaffaqiyatli.');
            await sequelize.sync({ alter: true });
            console.log('✅ Ma\'lumotlar bazasi sinxronizatsiya qilindi.');
        } else {
            console.log('ℹ️ PostgreSQL konfiguratsiyasi topilmadi, faqat MongoDB ishlatiladi.');
        }
        
        await connectMongoDB();
    } catch (error) {
        console.error('❌ DB ulanishida xato:', error.message);
        setTimeout(connectDB, 5000);
    }
};

module.exports = { sequelize, connectDB };
