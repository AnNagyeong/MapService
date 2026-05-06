require('dotenv').config(); // 1. 비밀 장부(.env)를 읽어온다.
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors()); // 2. 프론트엔드의 접속을 허용한다.

// 3. DB 접속 정보 (장부에서 가져와서 보안 유지!!!)
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

// 4. POI 데이터를 주는 통로
app.get('/api/poi', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        // 정규화된 'poi' 테이블에서 데이터를 가져온다.
        const [rows] = await connection.execute('SELECT * FROM poi');
        res.json(rows);
        await connection.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Edge(경로) 데이터를 주는 통로
app.get('/api/edge', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        // 'path_connection' 테이블에서 데이터를 가져온다.
        const [rows] = await connection.execute('SELECT * FROM path_connection');
        res.json(rows);
        await connection.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('백엔드가 3000번 포트에서 안전하게 실행 중입니다!'));