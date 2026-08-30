const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', verifyToken(['admin']), userController.create);
router.get('/', verifyToken(['admin']), userController.getAll);
router.put('/:id', verifyToken(['admin']), userController.updateUser);
router.delete('/:id', verifyToken(['admin']), userController.deactivateUser);

module.exports = router;