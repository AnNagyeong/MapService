require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 8080;
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use('/panoramas', express.static(path.join(__dirname, '../Test/panoramas')));
app.use('/images', express.static(path.join(__dirname, '../Test/images')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '..')));

// panoramas 폴더가 없으면 자동 생성
const panoramasDir = path.join(__dirname, '../Test/panoramas');
if (!fs.existsSync(panoramasDir)) fs.mkdirSync(panoramasDir, { recursive: true });
const accessibilityUploadDir = path.join(__dirname, '../uploads/accessibility-reports');
if (!fs.existsSync(accessibilityUploadDir)) {
    fs.mkdirSync(accessibilityUploadDir, { recursive: true });
}

// ── multer 설정 (파노라마 사진 업로드) ──────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, panoramasDir),
    filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `node_${req.params.id}${ext}`);
}
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
    }
});;

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

// DB 연결 헬퍼 (매 요청마다 연결/해제)
async function withDB(fn) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        return await fn(conn);
    } finally {
        await conn.end();
    }
}

async function ensureAccessibilityTables() {
    await withDB(async (conn) => {
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS user_report (
                report_id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(50) NULL,
                poi_id VARCHAR(36) NULL,
                place_name VARCHAR(100) NULL,
                place_address VARCHAR(255) NULL,
                latitude DECIMAL(10, 8) NOT NULL,
                longitude DECIMAL(11, 8) NOT NULL,
                category VARCHAR(50) NULL,
                wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') DEFAULT 'UNKNOWN',
                description TEXT NULL,
                photo_url VARCHAR(255) NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP NULL
            )
        `);

        await ensureColumn(conn, 'user_report', 'place_name',
            "ADD COLUMN place_name VARCHAR(100) NULL AFTER poi_id");
        await ensureColumn(conn, 'user_report', 'place_address',
            "ADD COLUMN place_address VARCHAR(255) NULL AFTER place_name");
        await ensureColumn(conn, 'user_report', 'wheelchair_access_status',
            "ADD COLUMN wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') DEFAULT 'UNKNOWN' AFTER category");
        await ensureColumn(conn, 'user_report', 'reviewed_at',
            "ADD COLUMN reviewed_at TIMESTAMP NULL AFTER created_at");

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS place_accessibility (
                place_accessibility_id VARCHAR(36) PRIMARY KEY,
                poi_id VARCHAR(36) NULL,
                place_name VARCHAR(100) NOT NULL,
                place_address VARCHAR(255) NULL,
                latitude DECIMAL(10, 8) NULL,
                longitude DECIMAL(11, 8) NULL,
                wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') DEFAULT 'UNKNOWN',
                source_report_id VARCHAR(36) NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
    });
}

async function ensureColumn(conn, tableName, columnName, alterSql) {
    const [rows] = await conn.execute(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbConfig.database, tableName, columnName]
    );

    if (!rows.length) {
        await conn.execute(`ALTER TABLE ${tableName} ${alterSql}`);
    }
}

/* =============================================
   GET /api/poi  ← 기존 그대로 유지
   ============================================= */
app.get('/api/poi', async (req, res) => {
    try {
        await withDB(async (conn) => {
            const [nodes] = await conn.execute(
                `SELECT poi_id as id, poi_name as name,
                        latitude as lat, longitude as lng,
                        poi_type as type, photo_url as panorama_url
                 FROM poi WHERE poi_type != 'building'`
            );
            const parsedNodes = nodes.map(n => ({
                ...n, lat: parseFloat(n.lat), lng: parseFloat(n.lng)
            }));

            const [buildings] = await conn.execute(
                `SELECT p.poi_id as id, p.poi_name as name,
                        p.latitude as lat, p.longitude as lng,
                        p.poi_type as type, p.photo_url as panorama_url,
                        be.entrance_poi_id
                 FROM poi p
                 JOIN building_entrance be
                   ON p.poi_id COLLATE utf8mb4_unicode_ci = be.building_poi_id
                 WHERE p.poi_type = 'building'`
            );

            const buildingMap = {};
            buildings.forEach(row => {
                if (!buildingMap[row.id]) {
                    buildingMap[row.id] = {
                        id: row.id, name: row.name,
                        lat: parseFloat(row.lat), lng: parseFloat(row.lng),
                        panorama_url: row.panorama_url,
                        type: row.type, entrances: []
                    };
                }
                buildingMap[row.id].entrances.push(row.entrance_poi_id);
            });

            res.json([...parsedNodes, ...Object.values(buildingMap)]);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =============================================
   GET /api/edge  ← 기존 그대로 유지
   ============================================= */
app.get('/api/edge', async (req, res) => {
    try {
        await withDB(async (conn) => {
            const [rows] = await conn.execute(
                `SELECT start_poi_id as \`from\`, end_poi_id as \`to\`,
                        distance as weight, type
                 FROM path_connection`
            );
            res.json(rows);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =============================================
   POI CRUD
   ============================================= */

// ── POST /api/poi  (노드 추가) ──────────────────────────────────────────────
app.post('/api/poi', async (req, res) => {
    const { name, lat, lng, type, photo_url } = req.body;
    if (!name || lat == null || lng == null || !type) {
        return res.status(400).json({ error: 'name, lat, lng, type 은 필수입니다.' });
    }
    try {
        await withDB(async (conn) => {
            const id = uuidv4();
            await conn.execute(
                `INSERT INTO poi (poi_id, poi_name, latitude, longitude, poi_type, photo_url)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, name, lat, lng, type, photo_url || null]
            );
            res.status(201).json({ id, name, lat, lng, type, panorama_url: photo_url || null });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── PUT /api/poi/:id  (노드 수정) ────────────────────────────────────────────
app.put('/api/poi/:id', async (req, res) => {
    const { id } = req.params;
    const { name, lat, lng, type, photo_url } = req.body;
    if (!name || lat == null || lng == null || !type) {
        return res.status(400).json({ error: 'name, lat, lng, type 은 필수입니다.' });
    }
    try {
        await withDB(async (conn) => {
            const [result] = await conn.execute(
                `UPDATE poi SET poi_name=?, latitude=?, longitude=?, poi_type=?, photo_url=?
                 WHERE poi_id=?`,
                [name, lat, lng, type, photo_url || null, id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: '노드를 찾을 수 없습니다.' });
            res.json({ id, name, lat, lng, type, panorama_url: photo_url || null });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/poi/:id  (노드 삭제) ────────────────────────────────────────
app.delete('/api/poi/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await withDB(async (conn) => {
            // 연결된 엣지, 건물-입구 관계 먼저 삭제 (FK 제약 방지)
            await conn.execute(
                `DELETE FROM path_connection WHERE start_poi_id=? OR end_poi_id=?`, [id, id]
            );
            await conn.execute(
                `DELETE FROM building_entrance WHERE building_poi_id=? OR entrance_poi_id=?`, [id, id]
            );
            const [result] = await conn.execute(`DELETE FROM poi WHERE poi_id=?`, [id]);
            if (result.affectedRows === 0) return res.status(404).json({ error: '노드를 찾을 수 없습니다.' });
            res.json({ ok: true, id });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── POST /api/poi/:id/photo  (파노라마 사진 업로드) ─────────────────────────
app.post('/api/poi/:id/photo', upload.single('photo'), async (req, res) => {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

    const photoUrl = `/panoramas/${req.file.filename}`;
    try {
        await withDB(async (conn) => {
            // 기존 사진 파일 삭제
            const [rows] = await conn.execute(`SELECT photo_url FROM poi WHERE poi_id=?`, [id]);
            if (rows.length === 0) return res.status(404).json({ error: '노드를 찾을 수 없습니다.' });

            const oldUrl = rows[0].photo_url;
            if (oldUrl) {
                const oldPath = path.join(__dirname, '../Test', oldUrl);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            await conn.execute(`UPDATE poi SET photo_url=? WHERE poi_id=?`, [photoUrl, id]);
            res.json({ ok: true, photo_url: photoUrl });
        });
    } catch (err) {
        // 업로드된 파일 롤백
        fs.unlinkSync(req.file.path);
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/poi/:id/photo  (파노라마 사진 삭제) ─────────────────────────
app.delete('/api/poi/:id/photo', async (req, res) => {
    const { id } = req.params;
    try {
        await withDB(async (conn) => {
            const [rows] = await conn.execute(`SELECT photo_url FROM poi WHERE poi_id=?`, [id]);
            if (rows.length === 0) return res.status(404).json({ error: '노드를 찾을 수 없습니다.' });

            const oldUrl = rows[0].photo_url;
            if (oldUrl) {
                const oldPath = path.join(__dirname, '../Test', oldUrl);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            await conn.execute(`UPDATE poi SET photo_url=NULL WHERE poi_id=?`, [id]);
            res.json({ ok: true });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =============================================
   Edge CRUD
   ============================================= */

// ── POST /api/edge  (엣지 추가) ─────────────────────────────────────────────
app.post('/api/edge', async (req, res) => {
    const { from, to, weight, type } = req.body;
    if (!from || !to || weight == null || !type) {
        return res.status(400).json({ error: 'from, to, weight, type 은 필수입니다.' });
    }
    try {
        await withDB(async (conn) => {
            // 중복 체크
            const [dup] = await conn.execute(
                `SELECT 1 FROM path_connection
                 WHERE (start_poi_id=? AND end_poi_id=?) OR (start_poi_id=? AND end_poi_id=?)
                 LIMIT 1`,
                [from, to, to, from]
            );
            if (dup.length > 0) return res.status(409).json({ error: '이미 존재하는 엣지입니다.' });

            await conn.execute(
                `INSERT INTO path_connection (start_poi_id, end_poi_id, distance, type)
                 VALUES (?, ?, ?, ?)`,
                [from, to, weight, type]
            );
            res.status(201).json({ from, to, weight, type });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/edge  (엣지 삭제) ───────────────────────────────────────────
app.delete('/api/edge', async (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from, to 는 필수입니다.' });
    try {
        await withDB(async (conn) => {
            const [result] = await conn.execute(
                `DELETE FROM path_connection
                 WHERE (start_poi_id=? AND end_poi_id=?) OR (start_poi_id=? AND end_poi_id=?)`,
                [from, to, to, from]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: '엣지를 찾을 수 없습니다.' });
            res.json({ ok: true });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =============================================
   building_entrance CRUD
   ============================================= */

// ── POST /api/building-entrance  (입구 관계 추가) ───────────────────────────
app.post('/api/building-entrance', async (req, res) => {
    const { building_id, entrance_id } = req.body;
    if (!building_id || !entrance_id) {
        return res.status(400).json({ error: 'building_id, entrance_id 는 필수입니다.' });
    }
    try {
        await withDB(async (conn) => {
            const [dup] = await conn.execute(
                `SELECT 1 FROM building_entrance WHERE building_poi_id=? AND entrance_poi_id=? LIMIT 1`,
                [building_id, entrance_id]
            );
            if (dup.length > 0) return res.status(409).json({ error: '이미 등록된 입구 관계입니다.' });

            await conn.execute(
                `INSERT INTO building_entrance (building_poi_id, entrance_poi_id) VALUES (?, ?)`,
                [building_id, entrance_id]
            );
            res.status(201).json({ ok: true, building_id, entrance_id });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── DELETE /api/building-entrance  (입구 관계 삭제) ─────────────────────────
app.delete('/api/building-entrance', async (req, res) => {
    const { building_id, entrance_id } = req.body;
    if (!building_id || !entrance_id) {
        return res.status(400).json({ error: 'building_id, entrance_id 는 필수입니다.' });
    }
    try {
        await withDB(async (conn) => {
            const [result] = await conn.execute(
                `DELETE FROM building_entrance WHERE building_poi_id=? AND entrance_poi_id=?`,
                [building_id, entrance_id]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: '입구 관계를 찾을 수 없습니다.' });
            res.json({ ok: true });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* =============================================
   휠체어 진입 제보
   ============================================= */
app.post('/api/accessibility-reports', async (req, res) => {
    const placeName = String(req.body.placeName || req.body.name || '').trim();
    const placeAddress = String(req.body.address || '').trim();
    const latitude = Number(req.body.y ?? req.body.lat);
    const longitude = Number(req.body.x ?? req.body.lng);

    if (!placeName || Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return res.status(400).json({
            ok: false,
            error: 'placeName, y, x 값이 필요합니다.'
        });
    }

    try {
        const reportId = req.body.id || uuidv4();
        const wheelchairStatus = toDbWheelchairStatus(req.body.wheelchairAccess);
        const photoUrl = saveAccessibilityReportImage(reportId, req.body.imageData);

        await withDB(async (conn) => {
            await conn.execute(
                `INSERT INTO user_report
                    (report_id, user_id, poi_id, place_name, place_address,
                     latitude, longitude, category, wheelchair_access_status,
                     description, photo_url, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
                [
                    reportId,
                    req.body.userId || null,
                    req.body.poiId || null,
                    placeName,
                    placeAddress || null,
                    latitude,
                    longitude,
                    req.body.type || req.body.category || null,
                    wheelchairStatus,
                    req.body.detail || req.body.description || null,
                    photoUrl
                ]
            );
        });

        res.status(201).json({
            ok: true,
            report: {
                id: reportId,
                placeName,
                address: placeAddress,
                wheelchairAccess: toApiWheelchairStatus(wheelchairStatus),
                status: 'pending',
                photoUrl
            }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.get('/api/accessibility-reports', async (req, res) => {
    const status = String(req.query.status || 'PENDING').toUpperCase();

    try {
        await withDB(async (conn) => {
            const [rows] = await conn.execute(
                `SELECT report_id, place_name, place_address, latitude, longitude,
                        category, wheelchair_access_status, description, photo_url,
                        status, created_at, reviewed_at
                 FROM user_report
                 WHERE status = ?
                 ORDER BY created_at DESC`,
                [status]
            );

            res.json({
                ok: true,
                reports: rows.map(formatAccessibilityReport)
            });
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/accessibility-reports/:id/approve', async (req, res) => {
    await reviewAccessibilityReport(req, res, 'APPROVED');
});

app.post('/api/accessibility-reports/:id/reject', async (req, res) => {
    await reviewAccessibilityReport(req, res, 'REJECTED');
});

app.get('/api/place-accessibility', async (req, res) => {
    const placeName = String(req.query.name || req.query.placeName || '').trim();
    const placeAddress = String(req.query.address || '').trim();
    const latitude = Number(req.query.lat ?? req.query.y);
    const longitude = Number(req.query.lng ?? req.query.x);

    if (!placeName && (Number.isNaN(latitude) || Number.isNaN(longitude))) {
        return res.status(400).json({
            ok: false,
            error: 'name 또는 좌표가 필요합니다.'
        });
    }

    try {
        await withDB(async (conn) => {
            let rows = [];

            if (placeName) {
                [rows] = await conn.execute(
                    `SELECT place_accessibility_id, place_name, place_address,
                            latitude, longitude, wheelchair_access_status,
                            source_report_id, updated_at
                     FROM place_accessibility
                     WHERE LOWER(place_name) = LOWER(?)
                       AND (? = '' OR COALESCE(place_address, '') = ?)
                     ORDER BY updated_at DESC
                     LIMIT 1`,
                    [placeName, placeAddress, placeAddress]
                );
            }

            if (!rows.length && !Number.isNaN(latitude) && !Number.isNaN(longitude)) {
                [rows] = await conn.execute(
                    `SELECT place_accessibility_id, place_name, place_address,
                            latitude, longitude, wheelchair_access_status,
                            source_report_id, updated_at,
                            (6371000 * ACOS(
                                COS(RADIANS(?)) * COS(RADIANS(latitude)) *
                                COS(RADIANS(longitude) - RADIANS(?)) +
                                SIN(RADIANS(?)) * SIN(RADIANS(latitude))
                            )) AS distance
                     FROM place_accessibility
                     HAVING distance <= 50
                     ORDER BY distance ASC, updated_at DESC
                     LIMIT 1`,
                    [latitude, longitude, latitude]
                );
            }

            const record = rows[0] || null;
            const status = toApiWheelchairStatus(record?.wheelchair_access_status);

            res.json({
                ok: true,
                status,
                label: accessibilityLabel(status),
                verified: Boolean(record),
                record: record ? formatPlaceAccessibility(record) : null
            });
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

async function reviewAccessibilityReport(req, res, nextStatus) {
    try {
        await withDB(async (conn) => {
            await conn.beginTransaction();

            try {
                const [reports] = await conn.execute(
                    `SELECT report_id, poi_id, place_name, place_address,
                            latitude, longitude, wheelchair_access_status
                     FROM user_report
                     WHERE report_id = ?
                     LIMIT 1`,
                    [req.params.id]
                );

                const report = reports[0];
                if (!report) {
                    await conn.rollback();
                    return res.status(404).json({ ok: false, error: '제보를 찾을 수 없습니다.' });
                }

                await conn.execute(
                    `UPDATE user_report
                     SET status = ?, reviewed_at = CURRENT_TIMESTAMP
                     WHERE report_id = ?`,
                    [nextStatus, req.params.id]
                );

                if (nextStatus === 'APPROVED') {
                    await conn.execute(
                        `DELETE FROM place_accessibility
                         WHERE LOWER(place_name) = LOWER(?)
                           AND COALESCE(place_address, '') = COALESCE(?, '')`,
                        [report.place_name, report.place_address]
                    );

                    await conn.execute(
                        `INSERT INTO place_accessibility
                            (place_accessibility_id, poi_id, place_name, place_address,
                             latitude, longitude, wheelchair_access_status, source_report_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            uuidv4(),
                            report.poi_id,
                            report.place_name,
                            report.place_address,
                            report.latitude,
                            report.longitude,
                            report.wheelchair_access_status,
                            report.report_id
                        ]
                    );
                }

                await conn.commit();

                res.json({
                    ok: true,
                    report: {
                        id: report.report_id,
                        status: nextStatus.toLowerCase()
                    }
                });
            } catch (err) {
                await conn.rollback();
                throw err;
            }
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
}

function saveAccessibilityReportImage(reportId, imageData) {
    if (typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
        return null;
    }

    const match = imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    if (!match) return null;

    const extension = match[1].toLowerCase().replace('jpeg', 'jpg');
    const fileName = `${reportId}.${extension}`;
    const filePath = path.join(accessibilityUploadDir, fileName);

    fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
    return `/uploads/accessibility-reports/${fileName}`;
}

function toDbWheelchairStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    if (value === 'accessible') return 'ACCESSIBLE';
    if (value === 'not_accessible') return 'NOT_ACCESSIBLE';
    return 'UNKNOWN';
}

function toApiWheelchairStatus(status) {
    const value = String(status || '').trim().toUpperCase();
    if (value === 'ACCESSIBLE') return 'accessible';
    if (value === 'NOT_ACCESSIBLE') return 'not_accessible';
    return 'unknown';
}

function accessibilityLabel(status) {
    if (status === 'accessible') return '휠체어 진입 가능';
    if (status === 'not_accessible') return '휠체어 진입 어려움';
    return '휠체어 진입 정보 확인 필요';
}

function formatAccessibilityReport(report) {
    const status = toApiWheelchairStatus(report.wheelchair_access_status);

    return {
        id: report.report_id,
        placeName: report.place_name,
        address: report.place_address,
        lat: parseFloat(report.latitude),
        lng: parseFloat(report.longitude),
        category: report.category,
        wheelchairAccess: status,
        wheelchairAccessLabel: accessibilityLabel(status),
        detail: report.description,
        photoUrl: report.photo_url,
        status: String(report.status || '').toLowerCase(),
        createdAt: report.created_at,
        reviewedAt: report.reviewed_at
    };
}

function formatPlaceAccessibility(record) {
    const status = toApiWheelchairStatus(record.wheelchair_access_status);

    return {
        id: record.place_accessibility_id,
        placeName: record.place_name,
        address: record.place_address,
        lat: record.latitude === null ? null : parseFloat(record.latitude),
        lng: record.longitude === null ? null : parseFloat(record.longitude),
        status,
        label: accessibilityLabel(status),
        sourceReportId: record.source_report_id,
        updatedAt: record.updated_at
    };
}

/* =============================================
   에러 핸들러 (multer 등)
   ============================================= */
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '파일 크기는 50MB 이하여야 합니다.' });
    res.status(500).json({ error: err.message });
});

app.use(express.static(path.join(__dirname, '../Test/graphManager2')));

app.get('/admin', (req, res) => {
    let html = fs.readFileSync(path.join(__dirname, '../Test/graphManager2/graphManager2.html'), 'utf-8');
    html = html.replace('__KAKAO_KEY__', process.env.KAKAO_MAP_KEY);
    res.send(html);
});

ensureAccessibilityTables()
    .then(() => {
        app.listen(PORT, () => console.log(`백엔드가 ${PORT}번 포트에서 실행 중입니다!`));
    })
    .catch((err) => {
        console.error('접근성 제보 테이블 준비 실패:', err.message);
        process.exit(1);
    });
