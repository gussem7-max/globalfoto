const pool = require('./db');

const createTables = async () => {
    try {
        // 1. Tabla de Usuarios (Súper Admin y Fotógrafos)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'photographer', -- 'admin' o 'photographer'
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Tabla de Eventos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                title VARCHAR(150) NOT NULL,
                description TEXT,
                event_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('¡Todas las tablas fueron creadas exitosamente!');
        process.exit(0);
    } catch (error) {
        console.error('Error al crear las tablas:', error);
        process.exit(1);
    }
};

createTables();