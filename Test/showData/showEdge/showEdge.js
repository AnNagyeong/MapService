
// ═══════════════════════════════════════════
//  상태
// ═══════════════════════════════════════════
let NODES = [], EDGES = [];
let nodeMap = {};           // id → node
let polylines = [];         // { edge, polyline, visible }
let nodeMarkers = [];       // { node, marker }
let selectedNodeId = null;
let activeFilters = new Set(["path","ramp","stair","elevator","crosswalk"]);

const TYPE_COLORS = {
    path:      "#2563eb",
    ramp:      "#16a34a",
    stair:     "#ef4444",
    elevator:  "#9333ea",
    crosswalk: "#f97316",
};

// ═══════════════════════════════════════════
//  데이터 로드
// ═══════════════════════════════════════════
Promise.all([
    fetch("../../data/poi.json").then(r => r.json()),
    fetch("../../data/edge.json").then(r => r.json()),
])
.then(([poiData, edgeData]) => {
    NODES = poiData.filter(p => p.type !== "building");
    EDGES = edgeData;
    nodeMap = Object.fromEntries(NODES.map(n => [n.id, n]));
    addLog(`노드 ${NODES.length}개, 엣지 ${EDGES.length}개 로드 완료`, "ok");
    initMap();
    buildTypeFilters();
    updateStats();
})
.catch(err => {
    addLog("데이터 로드 실패: " + err.message, "err");
});

// ═══════════════════════════════════════════
//  카카오맵 초기화
// ═══════════════════════════════════════════
let map;

function initMap() {
    map = new kakao.maps.Map(document.getElementById("map"), {
        center: new kakao.maps.LatLng(37.55843493, 127.04983095),
        level: 3,
    });

    // 노드 마커
    NODES.forEach(n => {
        const marker = new kakao.maps.Marker({
            map,
            position: new kakao.maps.LatLng(n.lat, n.lng),
            title: `#${n.id} ${n.name}`,
        });

        const iw = new kakao.maps.InfoWindow({ removable: false });

        kakao.maps.event.addListener(marker, "mouseover", () => {
            iw.setContent(
                `<div style="padding:5px;font-size:12px">` +
                `<b>#${n.id}</b> ${n.name}<br>` +
                `<span style="color:#888">${n.type}</span></div>`
            );
            iw.open(map, marker);
        });

        kakao.maps.event.addListener(marker, "mouseout", () => iw.close());

        // 클릭 시 해당 노드 엣지 필터
        kakao.maps.event.addListener(marker, "click", () => {
            document.getElementById("nodeIdInput").value = n.id;
            filterByNode();
        });

        nodeMarkers.push({ node: n, marker });
    });

    // 엣지 폴리라인
    EDGES.forEach(e => {
        const from = nodeMap[e.from];
        const to   = nodeMap[e.to];
        if (!from || !to) return;

        const polyline = new kakao.maps.Polyline({
            map,
            path: [
                new kakao.maps.LatLng(from.lat, from.lng),
                new kakao.maps.LatLng(to.lat, to.lng),
            ],
            strokeWeight: 3,
            strokeColor: TYPE_COLORS[e.type] || "#888",
            strokeOpacity: 0.8,
            strokeStyle: "solid",
        });

        // 엣지 클릭 시 정보 로그
        kakao.maps.event.addListener(polyline, "click", () => {
            addLog(`엣지 클릭: #${e.from} → #${e.to} | ${e.type} | ${e.weight}m`, "info");
        });

        polylines.push({ edge: e, polyline, visible: true });
    });

    document.getElementById("totalEdge").textContent = EDGES.length;
    document.getElementById("visibleEdge").textContent = EDGES.length;
}

// ═══════════════════════════════════════════
//  타입 필터 UI 생성
// ═══════════════════════════════════════════
function buildTypeFilters() {
    const container = document.getElementById("typeFilters");
    Object.entries(TYPE_COLORS).forEach(([type, color]) => {
        const count = EDGES.filter(e => e.type === type).length;
        const row = document.createElement("div");
        row.className = "edge-type-row";
        row.innerHTML = `
            <input type="checkbox" id="filter_${type}" checked
                onchange="toggleTypeFilter('${type}', this.checked)">
            <div class="color-dot" style="background:${color}"></div>
            <label for="filter_${type}">${type} (${count})</label>
        `;
        container.appendChild(row);
    });
}

function toggleTypeFilter(type, checked) {
    if (checked) activeFilters.add(type);
    else activeFilters.delete(type);
    applyFilters();
}

// ═══════════════════════════════════════════
//  표시 제어
// ═══════════════════════════════════════════
function showAllEdges() {
    selectedNodeId = null;
    activeFilters = new Set(Object.keys(TYPE_COLORS));
    document.querySelectorAll("[id^='filter_']").forEach(cb => cb.checked = true);
    applyFilters();
    document.getElementById("selectedNode").textContent = "없음";
    addLog("전체 엣지 표시", "info");
}

function hideAllEdges() {
    polylines.forEach(({ polyline }) => polyline.setMap(null));
    polylines.forEach(p => p.visible = false);
    document.getElementById("visibleEdge").textContent = 0;
    addLog("전체 엣지 숨김", "info");
}

function applyFilters() {
    let count = 0;
    polylines.forEach(({ edge, polyline }) => {
        const typeOk = activeFilters.has(edge.type);
        const nodeOk = selectedNodeId === null
            || edge.from === selectedNodeId
            || edge.to   === selectedNodeId;
        const show = typeOk && nodeOk;
        polyline.setMap(show ? map : null);
        if (show) count++;
    });
    document.getElementById("visibleEdge").textContent = count;
}

// ═══════════════════════════════════════════
//  노드 필터
// ═══════════════════════════════════════════
function filterByNode() {
    const id = Number(document.getElementById("nodeIdInput").value);
    if (!id || !nodeMap[id]) {
        addLog(`노드 #${id} 없음`, "warn");
        return;
    }
    selectedNodeId = id;
    document.getElementById("selectedNode").textContent = `#${id} ${nodeMap[id].name}`;

    const connected = EDGES.filter(e => e.from === id || e.to === id);
    applyFilters();
    addLog(`#${id} ${nodeMap[id].name} → 연결 엣지 ${connected.length}개`, "info");

    // 해당 노드 중앙 이동
    map.setCenter(new kakao.maps.LatLng(nodeMap[id].lat, nodeMap[id].lng));
}

function clearNodeFilter() {
    selectedNodeId = null;
    document.getElementById("nodeIdInput").value = "";
    document.getElementById("selectedNode").textContent = "없음";
    applyFilters();
    addLog("노드 필터 해제", "info");
}

// ═══════════════════════════════════════════
//  엣지 추가
// ═══════════════════════════════════════════
function addEdge() {
    const from = Number(document.getElementById("addFrom").value);
    const to   = Number(document.getElementById("addTo").value);
    const type = document.getElementById("addType").value;

    if (!from || !to) { addLog("from, to를 입력하세요", "warn"); return; }
    if (!nodeMap[from]) { addLog(`노드 #${from} 없음`, "err"); return; }
    if (!nodeMap[to])   { addLog(`노드 #${to} 없음`, "err"); return; }

    const dup = EDGES.find(e =>
        (e.from === from && e.to === to) || (e.from === to && e.to === from)
    );
    if (dup) { addLog(`이미 존재하는 엣지: #${from} ↔ #${to}`, "warn"); return; }

    // 거리 계산
    const n1 = nodeMap[from], n2 = nodeMap[to];
    const weight = haversine(n1.lat, n1.lng, n2.lat, n2.lng);

    const edge = { from, to, weight, type };
    EDGES.push(edge);

    // 폴리라인 추가
    const polyline = new kakao.maps.Polyline({
        map,
        path: [
            new kakao.maps.LatLng(n1.lat, n1.lng),
            new kakao.maps.LatLng(n2.lat, n2.lng),
        ],
        strokeWeight: 3,
        strokeColor: TYPE_COLORS[type] || "#888",
        strokeOpacity: 0.8,
        strokeStyle: "solid",
    });

    kakao.maps.event.addListener(polyline, "click", () => {
        addLog(`엣지 클릭: #${from} → #${to} | ${type} | ${weight}m`, "info");
    });

    polylines.push({ edge, polyline, visible: true });

    document.getElementById("totalEdge").textContent = EDGES.length;
    document.getElementById("addFrom").value = "";
    document.getElementById("addTo").value = "";
    addLog(`엣지 추가: #${from} → #${to} | ${type} | ${weight}m`, "ok");
    updateStats();
}

// ═══════════════════════════════════════════
//  검증
// ═══════════════════════════════════════════
function validateEdges() {
    addLog("── 전체 검증 시작 ──", "info");
    let errCount = 0;

    EDGES.forEach((e, i) => {
        if (!nodeMap[e.from]) {
            addLog(`[${i}] from #${e.from} 노드 없음`, "err"); errCount++;
        }
        if (!nodeMap[e.to]) {
            addLog(`[${i}] to #${e.to} 노드 없음`, "err"); errCount++;
        }
        if (e.from === e.to) {
            addLog(`[${i}] 자기 자신 연결: #${e.from}`, "warn"); errCount++;
        }
        if (!e.weight || e.weight <= 0) {
            addLog(`[${i}] #${e.from}→#${e.to} weight 이상: ${e.weight}`, "warn"); errCount++;
        }
        if (!TYPE_COLORS[e.type]) {
            addLog(`[${i}] #${e.from}→#${e.to} 알 수 없는 type: ${e.type}`, "warn"); errCount++;
        }
    });

    if (errCount === 0) addLog("✅ 검증 완료 — 문제 없음", "ok");
    else addLog(`⚠️ 총 ${errCount}개 문제 발견`, "warn");
}

function checkIsolated() {
    addLog("── 고립 노드 검사 ──", "info");
    const connected = new Set();
    EDGES.forEach(e => { connected.add(e.from); connected.add(e.to); });
    const isolated = NODES.filter(n => !connected.has(n.id));

    if (isolated.length === 0) {
        addLog("✅ 고립 노드 없음", "ok");
    } else {
        isolated.forEach(n => addLog(`고립: #${n.id} ${n.name}`, "err"));
        addLog(`총 ${isolated.length}개 고립 노드`, "warn");
    }
}

function checkDuplicates() {
    addLog("── 중복 엣지 검사 ──", "info");
    const seen = new Set();
    let dupCount = 0;

    EDGES.forEach(e => {
        const key = [Math.min(e.from, e.to), Math.max(e.from, e.to)].join("-");
        if (seen.has(key)) {
            addLog(`중복: #${e.from} ↔ #${e.to}`, "warn"); dupCount++;
        }
        seen.add(key);
    });

    if (dupCount === 0) addLog("✅ 중복 엣지 없음", "ok");
    else addLog(`총 ${dupCount}개 중복`, "warn");
}

// ═══════════════════════════════════════════
//  JSON 내보내기
// ═══════════════════════════════════════════
function exportJSON() {
    const json = JSON.stringify(EDGES, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "edge.json";
    a.click();
    addLog(`edge.json 내보내기 완료 (${EDGES.length}개)`, "ok");
}

// ═══════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    return Math.round(6371000 * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

function updateStats() {
    document.getElementById("totalEdge").textContent = EDGES.length;
}

function addLog(msg, level = "info") {
    const log = document.getElementById("log");
    const div = document.createElement("div");
    div.className = `log-item log-${level}`;
    div.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    log.prepend(div);
}

function clearLog() {
    document.getElementById("log").innerHTML = "";
}