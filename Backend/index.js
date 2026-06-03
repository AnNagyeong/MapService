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

        // 일반 노드
        const [nodes] = await connection.execute(
            `SELECT poi_id as id, poi_name as name, 
            latitude as lat, longitude as lng,
            poi_type as type
            FROM poi WHERE poi_type != 'building'`
        );

        // lat, lng 숫자로 변환
        const parsedNodes = nodes.map(n => ({
            ...n,
            lat: parseFloat(n.lat),
            lng: parseFloat(n.lng)
        })); //컬럼명 바꾸고 가져옴

        // 건물 + 입구 목록
        const [buildings] = await connection.execute(
            `SELECT p.poi_id as id, p.poi_name as name, 
            p.latitude as lat, p.longitude as lng, p.poi_type as type,
            be.entrance_poi_id
            FROM poi p
            JOIN building_entrance be 
            ON p.poi_id COLLATE utf8mb4_unicode_ci = be.building_poi_id
            WHERE p.poi_type = 'building'`
        );
        console.log(buildings[0]);
        // building별로 entrances 배열로 묶기
        const buildingMap = {};
        buildings.forEach(row => {
            if (!buildingMap[row.id]) {
                buildingMap[row.id] = {
                    id: row.id, name: row.name,
                    lat: parseFloat(row.lat),
                    lng: parseFloat(row.lng),
                    type: row.type, entrances: []
                };
            }
            buildingMap[row.id].entrances.push(row.entrance_poi_id);
        });

        const result = [...parsedNodes, ...Object.values(buildingMap)];
        res.json(result);
        await connection.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Edge(경로) 데이터를 주는 통로
app.get('/api/edge', async (req, res) => {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(
            `SELECT start_poi_id as \`from\`, end_poi_id as \`to\`,
                    distance as weight, type
            FROM path_connection`
        );
        res.json(rows);
        await connection.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log('백엔드가 3000번 포트에서 안전하게 실행 중입니다!'));