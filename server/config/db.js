const mysql = require('mysql');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root', // Cambia esto si usas otro usuario
    password: '', // Cambia esto si tienes contraseña
    database: 'marcar_llegada'
});

db.connect(err => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err);
        process.exit(1); // Termina el proceso si no puede conectar
    }
    console.log('Conectado a la base de datos.');
});

module.exports = db;
