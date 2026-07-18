require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for Base64 image uploads

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/mapa_db',
});

function userId(req) {
  return Number(req.query.user_id || req.body.created_by || req.body.user_id || 1);
}

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

// === MIDDLEWARE ===
// Middleware untuk mengecek apakah user adalah Admin
const isAdmin = async (req, res, next) => {
  try {
    const uid = userId(req);
    const user = await query('SELECT role FROM users WHERE id=$1', [uid]);
    if (!user.length || user[0].role !== 'admin') {
      return res.status(403).json({ error: 'Akses Ditolak: Fitur ini hanya untuk Admin.' });
    }
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// === API ROUTES ===

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected', time: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const rows = await query('SELECT id, nama, email, no_hp, foto_profil, role, created_at FROM users WHERE email=$1 AND password=$2 LIMIT 1', [email, password]);
    if (!rows.length) return res.status(401).json({ message: 'Email atau password salah' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { nama, email, password, no_hp, role } = req.body;
    const rows = await query(
      'INSERT INTO users (nama,email,password,no_hp,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,nama,email,no_hp,role,created_at',
      [nama, email, password, no_hp || null, role || 'petugas']
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fitur Lupa Password Mandiri (Validasi Email & No HP)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, no_hp, new_password } = req.body;
    const user = await query('SELECT id FROM users WHERE email=$1 AND no_hp=$2', [email, no_hp]);
    if (!user.length) return res.status(400).json({ message: 'Data Email dan Nomor HP tidak cocok.' });
    
    await query('UPDATE users SET password=$1 WHERE id=$2', [new_password, user[0].id]);
    res.json({ message: 'Password berhasil direset. Silakan login kembali.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fitur Ubah Foto Profil
app.put('/api/users/profile', async (req, res) => {
  try {
    const { foto_profil } = req.body;
    const uid = userId(req);
    await query('UPDATE users SET foto_profil=$1 WHERE id=$2', [foto_profil, uid]);
    res.json({ message: 'Profil berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fitur Ubah Password
app.put('/api/users/change-password', async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    const uid = userId(req);
    
    // Verifikasi password lama
    const user = await query('SELECT id FROM users WHERE id=$1 AND password=$2', [uid, old_password]);
    if (!user.length) return res.status(400).json({ message: 'Password lama salah!' });
    
    // Update ke password baru
    await query('UPDATE users SET password=$1 WHERE id=$2', [new_password, uid]);
    res.json({ message: 'Password berhasil diubah. Silakan login kembali dengan password baru.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const totalTelur = await query('SELECT COALESCE(SUM(jumlah_telur),0)::int AS total FROM produksi_telur');
    const totalPenjualan = await query('SELECT COALESCE(SUM(total_harga),0)::numeric AS total FROM penjualan');
    const totalTelurTerjual = await query('SELECT COALESCE(SUM(jumlah_butir),0)::int AS total FROM penjualan');
    const feed = await query('SELECT COALESCE(SUM(stok_kg),0)::numeric AS stok FROM pakan');
    const prod = await query(`
      SELECT tanggal, COALESCE(SUM(jumlah_telur),0)::int AS total
      FROM produksi_telur
      GROUP BY tanggal
      ORDER BY tanggal DESC
      LIMIT 7
    `);
    const sales = await query(`
      SELECT tanggal, COALESCE(SUM(total_harga),0)::numeric AS total
      FROM penjualan
      GROUP BY tanggal
      ORDER BY tanggal DESC
      LIMIT 7
    `);
    const p = prod.reverse().map(x => Number(x.total));
    const s = sales.reverse().map(x => Number(x.total) / 1000000);
    
    const recent_activities = await query(`
      SELECT 'Produksi' AS type, 'Pencatatan produksi ' || p.jumlah_telur || ' Butir' AS desc, p.tanggal AS date, u.nama AS user
      FROM produksi_telur p LEFT JOIN users u ON p.created_by = u.id
      UNION ALL
      SELECT 'Penjualan' AS type, 'Penjualan ' || j.jumlah_butir || ' Butir ke ' || j.pembeli AS desc, j.tanggal AS date, u.nama AS user
      FROM penjualan j LEFT JOIN users u ON j.created_by = u.id
      ORDER BY date DESC LIMIT 3
    `);

    // Info telur rusak di dashboard
    const afkir = await query('SELECT COALESCE(SUM(telur_rusak + telur_abnormal),0)::int AS total_afkir FROM produksi_telur');

    // Persentase Kenaikan Pendapatan (Bulan Ini vs Bulan Lalu)
    const currentMonthRevenue = await query(`SELECT COALESCE(SUM(total_harga),0)::numeric AS total FROM penjualan WHERE date_trunc('month', tanggal) = date_trunc('month', CURRENT_DATE)`);
    const lastMonthRevenue = await query(`SELECT COALESCE(SUM(total_harga),0)::numeric AS total FROM penjualan WHERE date_trunc('month', tanggal) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')`);
    
    let penjualan_percentage = 0;
    const curRev = Number(currentMonthRevenue[0].total);
    const lastRev = Number(lastMonthRevenue[0].total);
    if (lastRev > 0) {
      penjualan_percentage = ((curRev - lastRev) / lastRev) * 100;
    } else if (curRev > 0) {
      penjualan_percentage = 100;
    }

    res.json({
      total_telur: Number(totalTelur[0].total),
      penjualan_percentage: Math.round(penjualan_percentage),
      total_penjualan: Number(totalPenjualan[0].total),
      stok_pakan: Number(feed[0].stok),
      stok_gudang: Math.max(0, Math.floor((Number(totalTelur[0].total) - Number(totalTelurTerjual[0].total)) / 30)),
      sisa_butir: Math.max(0, (Number(totalTelur[0].total) - Number(totalTelurTerjual[0].total)) % 30),
      total_butir: Math.max(0, (Number(totalTelur[0].total) - Number(totalTelurTerjual[0].total))),
      total_afkir: Number(afkir[0]?.total_afkir || 0),
      produksi_7_hari: p.length ? p : [0,0,0,0,0,0,0],
      pendapatan_7_hari: s.length ? s : [0,0,0,0,0,0,0],
      aktivitas_terakhir: recent_activities
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const trend_produksi_raw = await query(`
      SELECT TO_CHAR(tanggal, 'YYYY-MM') AS bulan, jenis_telur, COALESCE(SUM(jumlah_telur), 0)::int AS total
      FROM produksi_telur
      WHERE tanggal >= CURRENT_DATE - INTERVAL '1 year'
      GROUP BY bulan, jenis_telur
      ORDER BY bulan DESC
    `);

    const grouped = {};
    for (const r of trend_produksi_raw) {
       if (!grouped[r.bulan]) grouped[r.bulan] = { bulan: r.bulan, total: 0, details: [] };
       grouped[r.bulan].total += r.total;
       grouped[r.bulan].details.push({ jenis: r.jenis_telur, total: r.total });
    }
    const trend_produksi = Object.values(grouped);

    const trend_harian = await query(`
      SELECT TO_CHAR(tanggal, 'YYYY-MM-DD') AS hari, COALESCE(SUM(jumlah_telur), 0)::int AS total
      FROM produksi_telur
      WHERE tanggal >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY hari
      ORDER BY hari ASC
    `);

    const { filter } = req.query;
    let filterCondition = "";
    if (filter) {
      if (filter === 'Bulan Ini') filterCondition = "WHERE tanggal >= CURRENT_DATE - INTERVAL '30 days'";
      else if (filter === 'Minggu Ini') filterCondition = "WHERE tanggal >= date_trunc('week', CURRENT_DATE)";
      else if (filter === 'Minggu Lalu') filterCondition = "WHERE tanggal >= date_trunc('week', CURRENT_DATE - INTERVAL '1 week') AND tanggal < date_trunc('week', CURRENT_DATE)";
      else if (filter === 'Januari') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 1";
      else if (filter === 'Februari') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 2";
      else if (filter === 'Maret') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 3";
      else if (filter === 'April') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 4";
      else if (filter === 'Mei') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 5";
      else if (filter === 'Juni') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 6";
      else if (filter === 'Juli') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 7";
      else if (filter === 'Agustus') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 8";
      else if (filter === 'September') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 9";
      else if (filter === 'Oktober') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 10";
      else if (filter === 'November') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 11";
      else if (filter === 'Desember') filterCondition = "WHERE EXTRACT(MONTH FROM tanggal) = 12";
      else if (filter === 'Tahun 2024') filterCondition = "WHERE EXTRACT(YEAR FROM tanggal) = 2024";
      else if (filter === 'Tahun 2025') filterCondition = "WHERE EXTRACT(YEAR FROM tanggal) = 2025";
      else if (filter === 'Tahun 2026') filterCondition = "WHERE EXTRACT(YEAR FROM tanggal) = 2026";
    }

    const komposisi_penjualan = await query(`
      SELECT jenis_telur as grade, COALESCE(SUM(jumlah_butir), 0)::int AS qty, COALESCE(SUM(total_harga), 0)::numeric AS revenue
      FROM penjualan
      ${filterCondition}
      GROUP BY grade
      ORDER BY revenue DESC
    `);

    res.json({ trend_produksi, trend_harian, komposisi_penjualan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/kandang', async (req, res) => {
  try {
    res.json(await query(`
      SELECT k.*, COALESCE(SUM(f.jumlah_sekarang),0)::int AS terisi
      FROM kandang k
      LEFT JOIN flock_batch f ON f.kandang_id = k.id
      GROUP BY k.id
      ORDER BY k.id DESC
    `));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/kandang', isAdmin, async (req, res) => {
  try {
    const { kode_kandang, nama_kandang, jenis_kandang, kapasitas, status } = req.body;
    const rows = await query('INSERT INTO kandang (kode_kandang,nama_kandang,jenis_kandang,kapasitas,status,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [kode_kandang, nama_kandang, jenis_kandang, kapasitas, status || 'Aktif', userId(req)]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/flocks', async (req, res) => {
  try { res.json(await query('SELECT * FROM flock_batch ORDER BY id DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/flocks', isAdmin, async (req, res) => {
  try {
    const b = req.body;
    const rows = await query(`INSERT INTO flock_batch (kode_batch,kandang_id,jenis_ayam,jumlah_awal,jumlah_sekarang,jumlah_mati,jumlah_sakit,umur_minggu,tanggal_masuk,status,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [b.kode_batch, b.kandang_id, b.jenis_ayam, b.jumlah_awal, b.jumlah_sekarang, b.jumlah_mati || 0, b.jumlah_sakit || 0, b.umur_minggu, b.tanggal_masuk, b.status || 'Produktif', userId(req)]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/produksi', async (req, res) => {
  try { res.json(await query('SELECT p.*, u.nama as nama_petugas FROM produksi_telur p LEFT JOIN users u ON p.created_by = u.id ORDER BY p.tanggal DESC, p.id DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/produksi', async (req, res) => {
  try {
    const b = req.body;
    const flock_id = b.flock_id || 1; 
    const tanggal = b.tanggal || new Date().toISOString().split('T')[0];
    const jumlah_telur = b.jumlah_telur || b.jumlah_butir || 0; // Telur bagus
    const telur_rusak = b.telur_rusak || 0;
    const telur_abnormal = b.telur_abnormal || 0;
    
    // Fallback kandang 1
    await query('INSERT INTO flock_batch (id, kode_batch, kandang_id, jenis_ayam, jumlah_awal, jumlah_sekarang, tanggal_masuk) VALUES (1, $1, NULL, $2, 0, 0, $3) ON CONFLICT (id) DO NOTHING', ['FB-DEFAULT', 'Layer', tanggal]);
    
    const rows = await query('INSERT INTO produksi_telur (flock_id,tanggal,jenis_telur,jumlah_telur,telur_rusak,telur_abnormal,kualitas,catatan,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [flock_id, tanggal, b.jenis_telur || 'Telur Ayam Ras', jumlah_telur, telur_rusak, telur_abnormal, b.kualitas || 'Baik', b.catatan || '', userId(req)]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/produksi/:id', isAdmin, async (req, res) => {
  try {
    const rows = await query('DELETE FROM produksi_telur WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/penjualan', async (req, res) => {
  try { res.json(await query('SELECT * FROM penjualan ORDER BY tanggal DESC, id DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/penjualan', async (req, res) => {
  try {
    const b = req.body;
    const total = b.total_harga || (Number(b.jumlah_butir || 0) * Number(b.harga_satuan || 0));
    
    // Catat penjualan ke database
    const rows = await query('INSERT INTO penjualan (tanggal,jenis_telur,jumlah_butir,harga_satuan,total_harga,pembeli,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [b.tanggal, b.jenis_telur, b.jumlah_butir, b.harga_satuan, total, b.pembeli, userId(req)]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/crm', async (req, res) => {
  try {
    // Ambil semua pembeli unik, hitung total transaksi dan belanjanya
    const rows = await query(`
      SELECT 
        pembeli AS name, 
        COUNT(id) AS transactions, 
        COALESCE(SUM(total_harga), 0)::numeric AS total
      FROM penjualan
      WHERE pembeli IS NOT NULL AND TRIM(pembeli) != ''
      GROUP BY pembeli
      ORDER BY total DESC
    `);
    
    // Tambahkan rank
    const ranked = rows.map((r, index) => ({
      ...r,
      rank: index + 1
    }));
    
    res.json(ranked);
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/pakan', async (req, res) => {
  try { res.json(await query('SELECT * FROM pakan ORDER BY id DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/penggunaan-pakan', async (req, res) => {
  try {
    const b = req.body;
    const rows = await query('INSERT INTO penggunaan_pakan (flock_id,pakan_id,tanggal,jumlah_kg,catatan,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [b.flock_id, b.pakan_id, b.tanggal, b.jumlah_kg, b.catatan, userId(req)]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/kesehatan', async (req, res) => {
  try { res.json(await query('SELECT * FROM kesehatan_ayam ORDER BY tanggal DESC, id DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/mutasi', async (req, res) => {
  try { res.json(await query('SELECT * FROM mutasi_populasi ORDER BY tanggal DESC, id DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// === MASTER JENIS TELUR ===
app.get('/api/jenis-telur', async (req, res) => {
  try { res.json(await query('SELECT * FROM jenis_telur_master ORDER BY kategori, nama, ukuran DESC')); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/jenis-telur', isAdmin, async (req, res) => {
  try {
    const { nama, kategori, ukuran, deskripsi, ciri_pembeda, harga_referensi } = req.body;
    const rows = await query(
      'INSERT INTO jenis_telur_master (nama, kategori, ukuran, deskripsi, ciri_pembeda, harga_referensi) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nama, kategori || 'Reguler', ukuran || 'Besar', deskripsi || '', ciri_pembeda || '', harga_referensi || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/jenis-telur/:id', isAdmin, async (req, res) => {
  try {
    const { nama, kategori, ukuran, deskripsi, ciri_pembeda, harga_referensi } = req.body;
    const rows = await query(
      'UPDATE jenis_telur_master SET nama=$1, kategori=$2, ukuran=$3, deskripsi=$4, ciri_pembeda=$5, harga_referensi=$6 WHERE id=$7 RETURNING *',
      [nama, kategori, ukuran, deskripsi, ciri_pembeda, harga_referensi || 0, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jenis-telur/:id', isAdmin, async (req, res) => {
  try {
    const rows = await query('DELETE FROM jenis_telur_master WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Auto-migrate: Pastikan struktur DB terupdate otomatis tanpa merusak data lama
async function migrateDatabase() {
  try {
    // 1. Tambah kolom ukuran di jenis_telur_master
    await pool.query('ALTER TABLE jenis_telur_master ADD COLUMN IF NOT EXISTS ukuran VARCHAR(20) DEFAULT \'Besar\'');
    
    // 2. Hapus konstrain UNIQUE(nama) jika masih ada (karena diganti jadi nama+ukuran)
    try {
      await pool.query('ALTER TABLE jenis_telur_master DROP CONSTRAINT IF EXISTS jenis_telur_master_nama_key');
    } catch(e) {}

    // 3. Tambah kolom telur afkir di produksi_telur
    await pool.query('ALTER TABLE produksi_telur ADD COLUMN IF NOT EXISTS telur_rusak INT DEFAULT 0');
    await pool.query('ALTER TABLE produksi_telur ADD COLUMN IF NOT EXISTS telur_abnormal INT DEFAULT 0');

    // 4. Bersihkan data dummy lama (Grade A) agar analytics rapi
    await pool.query("DELETE FROM penjualan WHERE jenis_telur = 'Grade A'");
    
    // 5. Seed Data Baru (Hanya jika kosong)
    const check = await pool.query('SELECT COUNT(*) FROM jenis_telur_master');
    if (Number(check.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO jenis_telur_master (nama, kategori, ukuran, deskripsi, ciri_pembeda, harga_referensi) VALUES
        ('Telur Ayam Ras', 'Reguler', 'Besar', 'Telur ayam ras standar ukuran besar dengan berat >=60g per butir.', 'Cangkang bersih dan utuh', 50000),
        ('Telur Ayam Ras', 'Reguler', 'Sedang', 'Telur ayam ras ukuran sedang dengan berat 50-59g per butir.', 'Ukuran sedikit lebih kecil', 42000),
        ('Telur Ayam Ras', 'Reguler', 'Kecil', 'Telur ayam ras ukuran kecil dengan berat <50g per butir.', 'Ukuran kecil, cangkang lebih tipis', 35000),
        ('Telur Omega-3', 'Premium', 'Besar', 'Telur kaya omega-3 ukuran besar.', 'Kuning telur lebih pekat', 65000),
        ('Telur Omega-3', 'Premium', 'Sedang', 'Telur kaya omega-3 ukuran sedang.', 'Kuning telur lebih pekat', 55000),
        ('Telur Organik', 'Premium', 'Besar', 'Telur ayam organik tanpa antibiotik ukuran besar.', 'Sertifikat organik', 75000),
        ('Telur Cage-Free', 'Premium', 'Besar', 'Telur dari ayam bebas ukuran besar.', 'Ayam bebas bergerak', 60000),
        ('Telur Asin', 'Olahan', 'Besar', 'Telur asin matang ukuran besar.', 'Cangkang kebiruan', 55000)
      `);
      console.log('✅ Seeded Data Jenis Telur (Versi Baru)');
    }
    console.log('✅ Database Migrations OK');
  } catch (err) {
    console.log('Migration Error:', err.message);
  }
}

const port = Number(process.env.PORT || 3000);
migrateDatabase().then(() => {
  app.listen(port, () => console.log(`MAPA API running on http://localhost:${port}/api`));
});
