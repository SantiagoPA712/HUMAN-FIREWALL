require('dotenv').config();

console.log("🧠 server iniciando...");

const app = require('./app'); // [Triggered Reload]


const PORT = process.env.PORT || 3000;


app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
});