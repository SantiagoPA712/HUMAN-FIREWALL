const db = require('./db');

async function initializeDB() {
    try {
        console.log("Iniciando creación de tablas en Supabase...");

        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255),
                role VARCHAR(50) DEFAULT 'employee',
                failed_attempts INT DEFAULT 0,
                lock_until TIMESTAMP,
                is_active BOOLEAN DEFAULT true,
                oauth_provider VARCHAR(50),
                oauth_id VARCHAR(255),
                total_points INT DEFAULT 0,
                level INT DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                token VARCHAR(255) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // --- EPIC 3: Gestión de Cursos ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                instructor_id INT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS course_contents (
                id SERIAL PRIMARY KEY,
                course_id INT REFERENCES courses(id) ON DELETE CASCADE,
                content_type VARCHAR(50) NOT NULL, -- video, pdf, text
                body TEXT NOT NULL,
                order_idx INT DEFAULT 0,
                points_reward INT DEFAULT 10
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS course_assignments (
                id SERIAL PRIMARY KEY,
                course_id INT REFERENCES courses(id) ON DELETE CASCADE,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'assigned', -- assigned, in-progress, completed
                completed_at TIMESTAMP,
                UNIQUE(course_id, user_id)
            );
        `);

        // --- EPIC 4 & 5: Simulaciones de Ciberseguridad ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS simulations (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                difficulty VARCHAR(50) DEFAULT 'beginner', -- beginner, intermediate, expert
                created_by INT REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS simulation_steps (
                id SERIAL PRIMARY KEY,
                simulation_id INT REFERENCES simulations(id) ON DELETE CASCADE,
                scenario_text TEXT NOT NULL,
                order_idx INT DEFAULT 1
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS simulation_options (
                id SERIAL PRIMARY KEY,
                step_id INT REFERENCES simulation_steps(id) ON DELETE CASCADE,
                option_text TEXT NOT NULL,
                is_correct BOOLEAN DEFAULT false,
                points_awarded INT DEFAULT 0,
                feedback_text TEXT
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS simulation_results (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                simulation_id INT REFERENCES simulations(id) ON DELETE CASCADE,
                total_score INT DEFAULT 0,
                status VARCHAR(50) DEFAULT 'completed',
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // --- EPIC 6 & 7: Gamificación ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS badges (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                points_required INT DEFAULT 0,
                icon_url VARCHAR(255)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS user_badges (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                badge_id INT REFERENCES badges(id) ON DELETE CASCADE,
                earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, badge_id)
            );
        `);

        // --- EPIC 8: Auditoría y Analítica ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id) ON DELETE CASCADE,
                action VARCHAR(100) NOT NULL,
                description TEXT,
                ip_address VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Tablas creadas correctamente. 🚀");
    } catch (error) {
        console.error("Error inicializando DB:", error);
    } finally {
        process.exit();
    }
}

initializeDB();
