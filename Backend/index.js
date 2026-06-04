require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/panoramas', express.static(path.join(__dirname, '../Test/panoramas')));

// panoramas 폴더가 없으면 자동 생성
const panoramasDir = path.join(__dirname, '../Test/panoramas');
if (!fs.existsSync(panoramasDir)) fs.mkdirSync(panoramasDir, { recursive: true });

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
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
    }
});

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
   에러 핸들러 (multer 등)
   ============================================= */
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '파일 크기는 50MB 이하여야 합니다.' });
    res.status(500).json({ error: err.message });
});

app.listen(3000, () => console.log('백엔드가 3000번 포트에서 실행 중입니다!'));