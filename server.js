import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import pg from 'pg';
import Parser from 'rss-parser';
import bcrypt from 'bcryptjs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

app.use(express.static('public'));
app.use('/public', express.static('public'));

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const pool = hasDatabaseUrl
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new pg.Pool({
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'gaming_app',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'Root',
      port: Number(process.env.PGPORT || 5432)
    });

function getUserId(req) {
  return req.session?.user?.id ?? 1;
}

function normalizeBcryptHash(hash) {
  if (typeof hash !== 'string') return '';
  // Legacy PHP bcrypt hashes use $2y$; bcryptjs expects $2a$/$2b$.
  if (hash.startsWith('$2y$')) return '$2a$' + hash.slice(4);
  return hash;
}

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function ensureRecoveryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recovery_games (
      id SERIAL PRIMARY KEY,
      title TEXT,
      home_team TEXT,
      away_team TEXT,
      score TEXT,
      league TEXT,
      price NUMERIC,
      description TEXT,
      booking_code TEXT,
      approved BOOLEAN DEFAULT FALSE,
      date_time TIMESTAMP DEFAULT NOW()
    )
  `);
}

function requireAuth(req, res) {
  if (!req.session?.user) {
    res.status(401).json({ success: false, error: 'Login required' });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (!req.session?.user || req.session.user.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin required' });
    return false;
  }
  return true;
}

// auth
app.post('/api/auth/register', async (req, res) => {
  await ensureUsersTable();
  const { name, email, password, password_confirm } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!name || !cleanEmail || !password || !password_confirm) {
    return res.json({ success: false, error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.json({ success: false, error: 'Password must be at least 6 characters' });
  }
  if (password !== password_confirm) {
    return res.json({ success: false, error: 'Passwords do not match' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length) {
      return res.json({ success: false, error: 'Email already registered' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1,$2,$3)',
      [name, cleanEmail, hash]
    );
    return res.json({ success: true, message: 'Registration successful. Please login.' });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  await ensureUsersTable();
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !password) {
    return res.json({ success: false, error: 'Email and password required' });
  }
  try {
    const result = await pool.query('SELECT id, name, email, password, role, is_active FROM users WHERE email = $1', [cleanEmail]);
    if (!result.rows.length) {
      return res.json({ success: false, error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    if (!user.is_active) {
      return res.json({ success: false, error: 'Account is disabled' });
    }
    const ok = await bcrypt.compare(password, normalizeBcryptHash(user.password));
    if (!ok) {
      return res.json({ success: false, error: 'Invalid email or password' });
    }
    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    req.session.user = safeUser;
    return res.json({ success: true, user: safeUser });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('connect.sid');
    if (err) return res.status(500).json({ success: false, error: 'Logout failed' });
    res.json({ success: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) return res.json({ success: false });
  return res.json({ success: true, user: req.session.user });
});

app.post('/api/auth/profile', async (req, res) => {
  if (!requireAuth(req, res)) return;
  await ensureUsersTable();
  const userId = req.session.user.id;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.json({ success: false, error: 'Name required' });
  try {
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, role',
      [name, userId]
    );
    const user = result.rows[0];
    if (!user) return res.json({ success: false, error: 'User not found' });
    req.session.user = user;
    return res.json({ success: true, user });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

app.post('/api/admin/make-admin', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  await ensureUsersTable();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.json({ success: false, error: 'Email required' });
  try {
    const result = await pool.query('UPDATE users SET role = $1 WHERE email = $2', ['admin', email]);
    if (!result.rowCount) return res.json({ success: false, error: 'User not found' });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

app.post('/api/admin/make-user', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  await ensureUsersTable();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.json({ success: false, error: 'Email required' });
  try {
    const result = await pool.query('UPDATE users SET role = $1 WHERE email = $2', ['user', email]);
    if (!result.rowCount) return res.json({ success: false, error: 'User not found' });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

// admin
app.get(['/api/admin', '/api/admin.php'], async (req, res) => {
  if (req.query.action !== 'list') return res.json([]);
  try {
    const { rows } = await pool.query('SELECT * FROM games');
    return res.json(rows);
  } catch (err) {
    return res.json([]);
  }
});

app.post(['/api/admin', '/api/admin.php'], async (req, res) => {
  const data = req.body || {};
  if (!requireAdmin(req, res)) return;
  if (data.action === 'add') {
    const booking_code = (data.booking_code || '').trim();
    const home_team = data.home_team || '-';
    const away_team = data.away_team || '-';
    const score = data.score || '0:0';
    const league = data.league || 'Booking Codes';
    const price = data.price || 0;
    const description = data.description || '';
    const title = data.title || (booking_code ? `Booking Code: ${booking_code}` : `${home_team} vs ${away_team}`);

    try {
      await pool.query(
        'INSERT INTO games (title, home_team, away_team, score, league, price, description, booking_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [title, home_team, away_team, score, league, price, description, booking_code]
      );
      return res.json({
        success: true,
        message: 'Booking code added successfully!',
        match: {
          title,
          booking_code,
          price: '$' + Number(price).toFixed(2)
        }
      });
    } catch (err) {
      return res.json({ success: false, error: err.message });
    }
  }

  if (data.action === 'delete') {
    try {
      await pool.query('DELETE FROM games WHERE id=$1', [data.id]);
      return res.json({ success: true, message: 'Game deleted successfully!' });
    } catch (err) {
      return res.json({ success: false, error: err.message });
    }
  }

  return res.json({ success: false, error: 'Invalid action' });
});

// games
app.get(['/api/games', '/api/games.php'], async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    const isAdmin = req.session?.user?.role === 'admin';
    if (userId) {
      const { rows } = await pool.query(
        `SELECT g.*,
        CASE WHEN $2::boolean THEN TRUE ELSE p.owned END AS owned,
        CASE WHEN $2::boolean OR p.owned THEN g.booking_code ELSE NULL END AS booking_code
        FROM games g
        CROSS JOIN LATERAL (
          SELECT EXISTS(
            SELECT 1 FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.user_id = $1 AND oi.game_id = g.id
          ) AS owned
        ) p
        ORDER BY g.id DESC`,
        [userId, isAdmin]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query('SELECT g.*, false AS owned, NULL::text AS booking_code FROM games g ORDER BY g.id DESC');
    return res.json(rows);
  } catch (err) {
    return res.json([]);
  }
});

// orders
app.post(['/api/orders', '/api/orders.php'], async (req, res) => {
  const data = req.body || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const total = data.total || 0;

  if (!items.length) {
    return res.json({ success: false, message: 'No items provided' });
  }

  if (!requireAuth(req, res)) return;
  const userId = getUserId(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      'INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id',
      [userId, total]
    );
    const orderId = orderRes.rows[0]?.id;
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, game_id, quantity) VALUES ($1, $2, $3)',
        [orderId, item.id, item.qty]
      );
    }
    await client.query('COMMIT');
    return res.json({ success: true, order_id: orderId });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// paystack_verify
app.post(['/api/paystack_verify', '/api/paystack_verify.php'], async (req, res) => {
  const { reference, expected_amount, currency } = req.body || {};
  if (!reference) return res.json({ success: false, message: 'Missing reference' });

  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  if (!secret) return res.json({ success: false, message: 'Paystack secret key not set' });

  try {
    const resp = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    if (!resp.ok) {
      return res.json({ success: false, message: 'Paystack verification failed', status: resp.status });
    }
    const payload = await resp.json();
    if (!payload || !payload.status) return res.json({ success: false, message: 'Invalid Paystack response' });

    const data = payload.data || {};
    if (data.status !== 'success') return res.json({ success: false, message: 'Payment not successful' });

    if (expected_amount != null && Number(data.amount) !== Number(expected_amount)) {
      return res.json({ success: false, message: 'Amount mismatch' });
    }
    if (currency && data.currency && String(currency).toUpperCase() !== String(data.currency).toUpperCase()) {
      return res.json({ success: false, message: 'Currency mismatch' });
    }
    return res.json({ success: true, message: 'Payment verified' });
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

// football_news
app.get(['/api/football_news', '/api/football_news.php'], async (req, res) => {
  const feeds = [
    { name: 'BBC Sport Football', url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
    { name: 'The Guardian Football', url: 'https://www.theguardian.com/football/rss' }
  ];
  const parser = new Parser();
  const items = [];

  for (const feed of feeds) {
    try {
      const data = await parser.parseURL(feed.url);
      for (const item of data.items || []) {
        items.push({
          title: item.title || '',
          link: item.link || '',
          pubDate: item.pubDate || item.isoDate || '',
          source: feed.name
        });
      }
    } catch {
      // ignore feed errors
    }
  }

  items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  return res.json({ items: items.slice(0, 12) });
});

// recovery
app.get(['/api/recovery', '/api/recovery.php'], async (req, res) => {
  await ensureRecoveryTable();
  try {
    if (req.session?.user?.role === 'admin') {
      const { rows } = await pool.query('SELECT * FROM recovery_games ORDER BY date_time DESC');
      return res.json(rows);
    }
    const { rows } = await pool.query(
      'SELECT id,title,home_team,away_team,price,approved,date_time FROM recovery_games WHERE approved = TRUE ORDER BY date_time DESC'
    );
    return res.json(rows);
  } catch (err) {
    return res.json([]);
  }
});

app.post(['/api/recovery', '/api/recovery.php'], async (req, res) => {
  await ensureRecoveryTable();
  const data = req.body || {};

  if (data.action === 'add') {
    if (!requireAdmin(req, res)) return;
    const booking = String(data.booking_code || '').trim().toUpperCase();
    if (!booking) return res.json({ success: false, error: 'Booking code required' });
    const title = `Booking Code: ${booking}`;
    const home = '-';
    const away = '-';
    const score = '0:0';
    const league = 'Booking Codes';
    const price = 0;
    const desc = '';

    const result = await pool.query(
      'INSERT INTO recovery_games (title,home_team,away_team,score,league,price,description,booking_code,approved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [title, home, away, score, league, price, desc, booking, false]
    );
    return res.json({ success: true, message: 'Recovery game added', id: result.rows[0]?.id });
  }

  if (data.action === 'approve') {
    if (!requireAdmin(req, res)) return;
    await pool.query('UPDATE recovery_games SET approved = TRUE WHERE id = $1', [data.id || 0]);
    return res.json({ success: true });
  }

  if (data.action === 'delete') {
    if (!requireAdmin(req, res)) return;
    await pool.query('DELETE FROM recovery_games WHERE id = $1', [data.id || 0]);
    return res.json({ success: true });
  }

  if (data.action === 'import') {
    if (!requireAdmin(req, res)) return;
    const id = data.id || 0;
    const { rows } = await pool.query('SELECT * FROM recovery_games WHERE id = $1', [id]);
    const row = rows[0];
    if (!row) return res.json({ success: false, error: 'Recovery game not found' });
    if (!row.approved) return res.json({ success: false, error: 'Recovery game not approved' });

    try {
      await pool.query(
        'INSERT INTO games (title,home_team,away_team,score,league,price,description,date_time,booking_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [row.title, row.home_team, row.away_team, row.score, row.league, row.price, row.description, row.date_time, row.booking_code]
      );
      await pool.query('DELETE FROM recovery_games WHERE id = $1', [id]);
      return res.json({ success: true, message: 'Imported into games table' });
    } catch (err) {
      return res.json({ success: false, error: 'Import failed: ' + err.message });
    }
  }

  return res.json({ success: false, error: 'Invalid action' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
