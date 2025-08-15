const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const DB_SOURCE = 'cocopan.db';

// Connect to the database
const db = new sqlite3.Database(DB_SOURCE, (err) => {
    if (err) {
        console.error(err.message);
        throw err;
    }
});

// Wrap the initialization in a promise to handle the async nature of database setup
const initializeDatabase = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Create User table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                settings TEXT
            )`, (err) => {
                if (err) return reject(err);

                // Add or update the default admin user
                const adminUsername = 'admin';
                db.get('SELECT * FROM users WHERE username = ?', [adminUsername], (err, row) => {
                    if (err) return reject(err);

                    // Hash the default password
                    bcrypt.hash('password', 10, (err, hash) => {
                        if (err) return reject(err);

                        if (!row) {
                            // If user doesn't exist, create it with the default password and settings
                            const defaultSettings = JSON.stringify({
                                championRecency: 30,
                                championFrequency: 5,
                                atRiskRecency: 90,
                            });
                            db.run('INSERT INTO users (username, password, settings) VALUES (?, ?, ?)', [adminUsername, hash, defaultSettings], (err) => {
                                if (err) return reject(err);
                                console.log('Default admin user created.');
                                resolve();
                            });
                        } else {
                            // If user already exists, UPDATE their password to the default to ensure login works
                            db.run('UPDATE users SET password = ? WHERE username = ?', [hash, adminUsername], (err) => {
                                if (err) return reject(err);
                                console.log('Admin password has been reset to default.');
                                resolve();
                            });
                        }
                    });
                });
            });

            // Create Analysis history table
            db.run(`CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                file_name TEXT,
                analysis_date TEXT,
                data TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`);
        });
    });
};

module.exports = { db, initializeDatabase };
