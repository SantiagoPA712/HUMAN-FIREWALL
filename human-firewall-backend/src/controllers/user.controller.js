const userService = require('../services/user.service');

exports.create = async (req, res) => {
    try {
        await userService.createUser(req.body);
        res.status(201).json({ msg: "Usuario creado" });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const users = await userService.getUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { role, is_active } = req.body;
        const db = require('../config/db'); // require en-línea para simpleza
        
        let queryOptions = [];
        let queryParams = [];
        let paramIdx = 1;

        if (role) {
            queryOptions.push(`role = $${paramIdx++}`);
            queryParams.push(role);
        }
        if (is_active !== undefined) {
            queryOptions.push(`is_active = $${paramIdx++}`);
            queryParams.push(is_active);
        }

        if (queryOptions.length > 0) {
            queryParams.push(id);
            await db.query(
                `UPDATE users SET ${queryOptions.join(', ')} WHERE id = $${paramIdx}`,
                queryParams
            );
        }

        res.status(200).json({ msg: "Usuario actualizado" });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};

exports.deactivateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const db = require('../config/db');
        await db.query("UPDATE users SET is_active = false WHERE id = $1", [id]);
        res.status(200).json({ msg: "Usuario desactivado" });
    } catch (error) {
        res.status(500).json({ msg: error.message });
    }
};