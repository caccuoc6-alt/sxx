'use strict';

const express = require('express');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const mongoose = require('mongoose');

const app = express();
const store = new MongoDBStore({
  uri: 'mongodb://localhost:27017/mydatabase', // Replace with your MongoDB connection string
  collection: 'sessions'
});

app.use(session({
  secret: 'your-secret-key', // Replace with your secret
  resave: false,
  saveUninitialized: false,
  store: store,
  cookie: {
    secure: true, // Set to true if using https
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // Example: 1 day
  }
}));

// Routes
app.post('/login/session', (req, res) => {
  // Implement your login logic here
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).send('Could not log out.');
    }
    res.clearCookie('connect.sid'); // Replace with your cookie name
    res.redirect('/'); // Redirect to home or other route
  });
});

app.get('/me', (req, res) => {
  if (req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).send('Unauthorized');
  }
});

// Your existing JWT auth code here...

mongoose.connect('mongodb://localhost:27017/mydatabase', { useNewUrlParser: true, useUnifiedTopology: true });

app.listen(3000, () => {
  console.log('Server listening on port 3000');
});
