// db.js
require("dotenv").config();
const mysql = require("mysql");

// Create a pool instead of a single connection
const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

// Safe promisified query helper
function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) return reject(err);

            connection.query(sql, params, (queryErr, results) => {
                connection.release(); // 🔥 critical fix — prevents stale DB state

                if (queryErr) return reject(queryErr);
                resolve(results);
            });
        });
    });
}

module.exports = {
    pool,
    query
};
