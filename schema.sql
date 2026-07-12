-- Tabel Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  no_hp VARCHAR(20),
  foto_profil TEXT,
  role VARCHAR(20) DEFAULT 'petugas',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Kandang
CREATE TABLE kandang (
  id SERIAL PRIMARY KEY,
  kode_kandang VARCHAR(50) UNIQUE NOT NULL,
  nama_kandang VARCHAR(100) NOT NULL,
  jenis_kandang VARCHAR(50),
  kapasitas INT NOT NULL,
  status VARCHAR(20) DEFAULT 'Aktif',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Flock Batch (Ayam)
CREATE TABLE flock_batch (
  id SERIAL PRIMARY KEY,
  kode_batch VARCHAR(50) UNIQUE NOT NULL,
  kandang_id INT REFERENCES kandang(id),
  jenis_ayam VARCHAR(50),
  jumlah_awal INT NOT NULL,
  jumlah_sekarang INT NOT NULL,
  jumlah_mati INT DEFAULT 0,
  jumlah_sakit INT DEFAULT 0,
  umur_minggu INT,
  tanggal_masuk DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'Produktif',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Produksi Telur
CREATE TABLE produksi_telur (
  id SERIAL PRIMARY KEY,
  flock_id INT REFERENCES flock_batch(id),
  tanggal DATE NOT NULL,
  jenis_telur VARCHAR(50) NOT NULL,
  jumlah_telur INT NOT NULL, -- (jumlah telur bagus)
  telur_rusak INT DEFAULT 0,
  telur_abnormal INT DEFAULT 0,
  kualitas VARCHAR(50),
  catatan TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Penjualan (Penting!)
CREATE TABLE penjualan (
  id SERIAL PRIMARY KEY,
  tanggal DATE NOT NULL,
  jenis_telur VARCHAR(50) NOT NULL,
  jumlah_butir INT NOT NULL,
  harga_satuan INT NOT NULL,
  total_harga NUMERIC NOT NULL,
  pembeli VARCHAR(100),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Pakan
CREATE TABLE pakan (
  id SERIAL PRIMARY KEY,
  nama_pakan VARCHAR(100) NOT NULL,
  stok_kg NUMERIC DEFAULT 0,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Penggunaan Pakan
CREATE TABLE penggunaan_pakan (
  id SERIAL PRIMARY KEY,
  flock_id INT REFERENCES flock_batch(id),
  pakan_id INT REFERENCES pakan(id),
  tanggal DATE NOT NULL,
  jumlah_kg NUMERIC NOT NULL,
  catatan TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Kesehatan Ayam
CREATE TABLE kesehatan_ayam (
  id SERIAL PRIMARY KEY,
  flock_id INT REFERENCES flock_batch(id),
  jenis_tindakan VARCHAR(50) NOT NULL,
  nama_tindakan VARCHAR(100) NOT NULL,
  jumlah_terdampak INT NOT NULL,
  tanggal DATE NOT NULL,
  status VARCHAR(20),
  catatan TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Mutasi Populasi
CREATE TABLE mutasi_populasi (
  id SERIAL PRIMARY KEY,
  flock_id INT REFERENCES flock_batch(id),
  jenis_mutasi VARCHAR(50) NOT NULL,
  jumlah INT NOT NULL,
  tanggal DATE NOT NULL,
  keterangan TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Laporan Keuangan (Opsional)
CREATE TABLE laporan_keuangan (
  id SERIAL PRIMARY KEY,
  jenis_transaksi VARCHAR(50),
  nominal NUMERIC,
  tanggal DATE,
  keterangan TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabel Master Jenis Telur
CREATE TABLE jenis_telur_master (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  kategori VARCHAR(50) NOT NULL,
  ukuran VARCHAR(20) DEFAULT 'Besar',
  deskripsi TEXT,
  ciri_pembeda TEXT,
  harga_referensi INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Data Jenis Telur Baru
INSERT INTO jenis_telur_master (nama, kategori, ukuran, deskripsi, ciri_pembeda, harga_referensi) VALUES
('Telur Ayam Ras', 'Reguler', 'Besar', 'Telur ayam ras standar ukuran besar dengan berat >=60g per butir.', 'Cangkang bersih dan utuh', 50000),
('Telur Ayam Ras', 'Reguler', 'Sedang', 'Telur ayam ras ukuran sedang dengan berat 50-59g per butir.', 'Ukuran sedikit lebih kecil', 42000),
('Telur Ayam Ras', 'Reguler', 'Kecil', 'Telur ayam ras ukuran kecil dengan berat <50g per butir.', 'Ukuran kecil, cangkang lebih tipis', 35000),
('Telur Omega-3', 'Premium', 'Besar', 'Telur kaya omega-3 ukuran besar.', 'Kuning telur lebih pekat', 65000),
('Telur Omega-3', 'Premium', 'Sedang', 'Telur kaya omega-3 ukuran sedang.', 'Kuning telur lebih pekat', 55000),
('Telur Organik', 'Premium', 'Besar', 'Telur ayam organik tanpa antibiotik ukuran besar.', 'Sertifikat organik', 75000),
('Telur Cage-Free', 'Premium', 'Besar', 'Telur dari ayam bebas ukuran besar.', 'Ayam bebas bergerak', 60000),
('Telur Asin', 'Olahan', 'Besar', 'Telur asin matang ukuran besar.', 'Cangkang kebiruan', 55000);

-- Masukkan Data Admin Default
INSERT INTO users (nama, email, password, no_hp, role) VALUES ('Admin MAPA', 'admin@mapa.com', 'admin123', '08123456789', 'admin');
INSERT INTO users (nama, email, password, no_hp, role) VALUES ('Budi Santoso', 'petugas@mapa.com', 'petugas123', '08987654321', 'petugas');
