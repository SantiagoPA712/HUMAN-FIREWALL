const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

require('./config/passport');
const passport = require('passport');

app.use(passport.initialize());

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/sso', require('./routes/sso.routes'));
app.use('/api/courses', require('./routes/course.routes'));
app.use('/api/simulations', require('./routes/simulation.routes'));
app.use('/api/gamification', require('./routes/gamification.routes'));

app.get('/', (req, res) => {
    res.send('API funcionando 🚀');
});

module.exports = app;