const express = require('express');
const router = express.Router();

// User Registration Endpoint
router.post('/register', (req, res) => {
    const { username, password } = req.body;
    // Add your logic for user registration here
    res.status(201).json({ message: 'User registered successfully' });
});

// User Login Endpoint
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    // Add your logic for user login here
    res.status(200).json({ message: 'User logged in successfully' });
});

module.exports = router;