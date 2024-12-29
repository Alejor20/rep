const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./config/db.js');
const csvWriter = require('csv-writer').createObjectCsvWriter;

const app = express();
const port = 3020;
const saltRounds = 10;



// Middleware para leer cuerpos en formato JSON
app.use(express.json());
app.use(express.static('../public'));  // Sirve archivos estáticos como HTML, CSS, JS

// Clave secreta para JWT
const JWT_SECRET = 'rogirn';

// Ruta para registrar un nuevo usuario
app.post('/register', (req, res) => {
    const { name, apellido, email, telefono, username, password, role } = req.body;

    if (!role || (role !== 'admin' && role !== 'user')) {
        return res.status(400).json({ message: 'Rol inválido' });
    }

    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) return res.status(500).json({ message: 'Error al cifrar la contraseña' });

        db.query(
            'INSERT INTO users (name, apellido, email, telefono, username, password, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, apellido, email, telefono, username, hash, role],
            (err, result) => {
                if (err) {
                    console.error('Error al guardar usuario:', err);
                    return res.status(500).json({ message: 'Error al guardar usuario en la base de datos' });
                }
                res.json({ success: true, message: 'Usuario registrado exitosamente' });
            }
        );
    });
});
;


// Ruta para el inicio de sesión
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Consulta para obtener el usuario de la base de datos
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) return res.status(500).json({ message: 'Error en la base de datos' });
        if (results.length === 0) return res.status(400).json({ message: 'Usuario no encontrado' });

        const user = results[0];

        // Comparar la contraseña proporcionada con la contraseña cifrada en la base de datos
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) return res.status(500).json({ message: 'Error al comparar contraseñas' });
            if (!isMatch) return res.status(400).json({ message: 'Contraseña incorrecta' });

            // Crear un token JWT
            const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ token });
        });
    });
});


// Middleware para verificar el token JWT
const authenticateJWT = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(403).json({ message: 'Token no proporcionado' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token inválido' });
        req.user = user;
        next();
    });
};
app.get('/verify-role', authenticateJWT, (req, res) => {
    res.json({ role: req.user.role });
});

// Ruta para marcar ubicación (solo usuarios autenticados)
app.post('/mark-location', authenticateJWT, (req, res) => {
    const { latitude, longitude } = req.body;
    const { id } = req.user;

    // Obtener la fecha y hora actuales
    const now = new Date();

    // Formatear la fecha como dd/mmm/aaaa
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const date = `${String(now.getDate()).padStart(2, '0')}/${months[now.getMonth()]}/${now.getFullYear()}`;
    
    // Formatear la hora como hh:mm:ss
    const time = now.toTimeString().split(' ')[0];

    // Función para calcular la distancia utilizando la fórmula Haversine
    const haversineDistance = (lat1, lon1, lat2, lon2) => {
        const toRadians = (degrees) => degrees * (Math.PI / 180);
        const R = 6371; // Radio de la Tierra en kilómetros
    
        const dLat = toRadians(lat2 - lat1);
        const dLon = toRadians(lon2 - lon1);
    
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
        return R * c; // Distancia en kilómetros
    };

    // Latitud y longitud de referencia
    const baseLat = 4.5807776;  // Latitud de referencia
    const baseLon = -74.1998889; // Longitud de referencia

    // Calculamos la distancia entre las coordenadas recibidas y las de referencia
    const distance = haversineDistance(latitude, longitude, baseLat, baseLon);
    console.log(`Distancia calculada: ${distance} km`);

    // Verificar si la distancia está fuera del rango permitido (1 km en este ejemplo)
    const maxDistance = 10;  // Distancia máxima permitida en kilómetros
    if (distance > maxDistance) {
        return res.status(400).json({ message: 'Ubicación fuera de rango' });
    }

    console.log(`Coordenadas recibidas: lat=${latitude}, lon=${longitude}`);

    // Guardar la ubicación en la base de datos si está dentro del rango
    db.query(
        'INSERT INTO locations (user_id, latitude, longitude, date, time) VALUES (?, ?, ?, ?, ?)',
        [id, latitude, longitude, date, time],
        (err, result) => {
            if (err) {
                console.error('Error al guardar ubicación:', err);
                return res.status(500).json({ message: 'Error al guardar ubicación' });
            }
            res.json({ message: 'Ubicación marcada exitosamente', date, time });
        });
   });

// Ruta para descargar el archivo CSV (solo admin)
app.get('/download-report', authenticateJWT, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Acceso denegado' });

    db.query('SELECT  u.name, u.apellido, u.username, l.latitude, l.longitude, l.date, l.time FROM locations l JOIN users u ON l.user_id = u.id', (err, results) => {
        if (err) {
            console.error('Error al obtener los datos:', err);
            return res.status(500).json({ message: 'Error al obtener los datos' });
        }
    
        console.log(results);  // Imprimir los resultados para ver los datos recibidos
    
        if (results.length === 0) {
            return res.status(404).json({ message: 'No se encontraron datos' });
        }
    
        const csv = csvWriter({
            path: 'report.csv',
            header: [
                
                { id: 'name', title: 'Nombre' },
                { id: 'apellido', title: 'Apellido' },
                { id: 'username', title: 'Usuario' },
                { id: 'latitude', title: 'Latitud' },
                { id: 'longitude', title: 'Longitud' },
                { id: 'date', title: 'Fecha' }  ,
                { id: 'time', title: 'Hora' }
            ]
        });
    
        // Escribir los registros en el CSV
        csv.writeRecords(results)
            .then(() => {
                res.download('report.csv', 'report.csv', (err) => {
                    if (err) {
                        console.error('Error al descargar el archivo:', err);
                        return res.status(500).json({ message: 'Error al descargar el archivo' });
                    }
                });
            });
    });
    
    
}); 

app.listen(port, () => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});
