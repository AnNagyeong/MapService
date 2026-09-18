require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
};

const panoramasDir = path.join(
    __dirname,
    '../../Test/panoramas'
);

const FILE_PATTERN =
    /^node_([0-9a-f-]{36})\.(jpg|jpeg|png|webp)$/i;

async function main() {
    console.log('====================================');
    console.log('  기존 파노라마 DB 자동 등록');
    console.log('====================================');
    console.log(`폴더: ${panoramasDir}`);
    console.log('');

    if (!fs.existsSync(panoramasDir)) {
        throw new Error(
            `파노라마 폴더를 찾을 수 없습니다: ${panoramasDir}`
        );
    }

    const files = fs.readdirSync(panoramasDir)
        .filter(file => FILE_PATTERN.test(file))
        .sort();

    console.log(`발견한 파노라마: ${files.length}개`);
    console.log('');

    if (files.length === 0) {
        console.log('등록할 파노라마가 없습니다.');
        return;
    }

    const conn = await mysql.createConnection(dbConfig);

    let registered = 0;
    let alreadyRegistered = 0;
    let missingPoi = 0;
    let conflicts = 0;

    try {
        await conn.beginTransaction();

        for (const file of files) {
            const match = file.match(FILE_PATTERN);

            if (!match) {
                continue;
            }

            const poiId = match[1];
            const photoUrl = `/panoramas/${file}`;

            const [rows] = await conn.execute(
                `
                SELECT poi_id, poi_name, photo_url
                FROM poi
                WHERE poi_id = ?
                `,
                [poiId]
            );

            if (rows.length === 0) {
                console.log(
                    `❌ POI 없음: ${file}`
                );
                missingPoi++;
                continue;
            }

            const poi = rows[0];

            // 이미 같은 사진이 등록되어 있는 경우
            if (poi.photo_url === photoUrl) {
                console.log(
                    `✓ 이미 등록됨: ${poi.poi_name}`
                );
                alreadyRegistered++;
                continue;
            }

            // 다른 사진이 이미 등록되어 있으면 덮어쓰지 않는다.
            if (poi.photo_url) {
                console.log(
                    `⚠️ 기존 사진 존재: ${poi.poi_name}`
                );
                console.log(
                    `   DB:   ${poi.photo_url}`
                );
                console.log(
                    `   파일: ${photoUrl}`
                );
                conflicts++;
                continue;
            }

            await conn.execute(
                `
                UPDATE poi
                SET photo_url = ?
                WHERE poi_id = ?
                `,
                [photoUrl, poiId]
            );

            console.log(
                `✓ 등록: ${poi.poi_name}`
            );
            console.log(
                `  ${photoUrl}`
            );

            registered++;
        }

        if (missingPoi > 0) {
            console.log('');
            console.log(
                `⚠️ POI를 찾지 못한 파일이 ${missingPoi}개 있습니다.`
            );

            // POI가 없는 파일이 있으면 전체 작업을 확정하지 않는다.
            await conn.rollback();

            console.log('');
            console.log(
                '❌ 등록을 중단했습니다. DB는 변경되지 않았습니다.'
            );
            return;
        }

        await conn.commit();

        console.log('');
        console.log('====================================');
        console.log('등록 결과');
        console.log('====================================');
        console.log(`신규 등록      : ${registered}`);
        console.log(`이미 등록됨    : ${alreadyRegistered}`);
        console.log(`기존 사진 충돌 : ${conflicts}`);
        console.log(`POI 없음       : ${missingPoi}`);
        console.log('====================================');

    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        await conn.end();
    }
}

main().catch(error => {
    console.error('');
    console.error('❌ 파노라마 등록 실패');
    console.error(error.message);
    process.exit(1);
});