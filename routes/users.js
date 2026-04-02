'use strict';

const express = require('express');
const router = express.Router();

// Sample data
let users = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
];

// Endpoint to get all users
router.get('/', (req, res) => {
    res.json(users);
});

// Endpoint to get user by ID
router.get('/:id', (req, res) => {
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) return res.status(404).send('User not found');
    res.json(user);
});

module.exports = router;