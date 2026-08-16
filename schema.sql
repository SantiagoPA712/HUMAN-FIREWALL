
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
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    instructor_id INT REFERENCES users(id) ON DELETE
    SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS course_contents (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL,
    body TEXT NOT NULL,
    order_idx INT DEFAULT 0,
    points_reward INT DEFAULT 10
);
CREATE TABLE IF NOT EXISTS course_assignments (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES courses(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'assigned',
    completed_at TIMESTAMP,
    UNIQUE(course_id, user_id)
);
CREATE TABLE IF NOT EXISTS simulations (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    difficulty VARCHAR(50) DEFAULT 'beginner',
    created_by INT REFERENCES users(id) ON DELETE
    SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS simulation_steps (
    id SERIAL PRIMARY KEY,
    simulation_id INT REFERENCES simulations(id) ON DELETE CASCADE,
    scenario_text TEXT NOT NULL,
    order_idx INT DEFAULT 1
);
CREATE TABLE IF NOT EXISTS simulation_options (
    id SERIAL PRIMARY KEY,
    step_id INT REFERENCES simulation_steps(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT false,
    points_awarded INT DEFAULT 0,
    feedback_text TEXT
);
CREATE TABLE IF NOT EXISTS simulation_results (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    simulation_id INT REFERENCES simulations(id) ON DELETE CASCADE,
    total_score INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'completed',
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS badges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    points_required INT DEFAULT 0,
    icon_url VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS user_badges (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    badge_id INT REFERENCES badges(id) ON DELETE CASCADE,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, badge_id)
);
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
    description TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS challenges (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    points_reward INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO challenges (id, name, points_reward) VALUES 
('wifi', 'Wi-Fi Seguro', 200),
('password', 'Maestro de Contraseñas', 150),
('social', 'Ingeniería Social', 250)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_challenge_results (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    challenge_id VARCHAR(50) REFERENCES challenges(id) ON DELETE CASCADE,
    won BOOLEAN DEFAULT false,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, challenge_id)
);

-- Insertar el Admin inicial manualmente (Password: AdminPassword123!)
INSERT INTO users (email, password, role)
VALUES (
        'admin@humanfirewall.com',
        '$2b$10$w6EOfG9PzOqG9sXlRQKQzOo9wBIfc/sQY2X1Ww2T2R9aJg9yD6Q2G',
        'admin'
    );
