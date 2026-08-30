const db = require('../config/db');
const { hashPassword } = require('../utils/hash');

exports.createUser = async (data) => {

    const hashed = await hashPassword(data.password);

    const result = await db.query(
        "INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role",
        [data.email, hashed, data.role || 'employee']
    );

    return result.rows[0];
};

exports.getUsers = async () => {
    const { rows } = await db.query("SELECT id, email, role FROM users");
    return rows;
};