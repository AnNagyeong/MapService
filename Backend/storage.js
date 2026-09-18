const fs = require('fs');
const path = require('path');

const panoramasDir = path.join(
    __dirname,
    '../Test/panoramas'
);

if (!fs.existsSync(panoramasDir)) {
    fs.mkdirSync(panoramasDir, {
        recursive: true
    });
}

function getPanoramaFilename(poiId, originalName = '') {
    const ext = path.extname(originalName) || '.jpg';
    return `node_${poiId}${ext}`;
}

function getLocalPanoramaPath(poiId, originalName = '') {
    return path.join(
        panoramasDir,
        getPanoramaFilename(poiId, originalName)
    );
}

function getLocalPanoramaUrl(poiId, originalName = '') {
    return `/panoramas/${getPanoramaFilename(
        poiId,
        originalName
    )}`;
}

module.exports = {
    panoramasDir,
    getPanoramaFilename,
    getLocalPanoramaPath,
    getLocalPanoramaUrl
};