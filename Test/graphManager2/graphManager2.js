/* =============================================
   캠퍼스 관리자 페이지
   ============================================= */

// ===== 지도 초기화 =====
var map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(37.55843493, 127.04983095),
    level: 3
});

const imageSize = new kakao.maps.Size(32, 32);
const isolatedSize = new kakao.maps.Size(38, 38);
const isolatedImage = new kakao.maps.MarkerImage("../images/redMarker.png", isolatedSize);

const markerImages = {
    entrance: new kakao.maps.MarkerImage("/images/blueMarker.png", imageSize),
    ramp: new kakao.maps.MarkerImage("/images/greenMarker.png", imageSize),
    stair: new kakao.maps.MarkerImage("/images/redMarker.png", imageSize),
    elevator: new kakao.maps.MarkerImage("/images/orangeMarker.png", imageSize),
    crosswalk: new kakao.maps.MarkerImage("/images/pinkMarker.png", imageSize),
    path: new kakao.maps.MarkerImage("/images/greyMarker.png", imageSize),
    building: new kakao.maps.MarkerImage("/images/yellowMarker.png", imageSize)
};

const NODE_COLORS = {
    entrance: "blue", ramp: "green", stair: "red", elevator: "orange",
    crosswalk: "hotpink", path: "darkgrey", building: "rgb(229,229,0)"
};

const EDGE_COLORS = {
    path: "#2563eb", ramp: "#16a34a", stair: "#ef4444",
    elevator: "#9333ea", crosswalk: "#f97316"
};

// ===== 인포윈도우 =====
var infowindow = new kakao.maps.InfoWindow({ removable: false });
var searchInfowindow = new kakao.maps.InfoWindow({ removable: true });
var edgeInfowindow = new kakao.maps.InfoWindow({ removable: false });

// ===== 전역 상태 =====
let allPoi = [], markers = [], polylines = [], nodeMap = {}, buildingList = [];

let selectedNodeId = null;
let edgesVisible = true;
let nodeFilterActive = false;
let activeNodeTypes = new Set();
let activeEdgeTypes = new Set();
let highlightMarkers = [];

// 경로 테스트
let pathPolyline = null;
let pathNodeIds = [];
let pathDisplay = "all";
let pathTab = "building";   // "building" | "node"
let pathFromNodeId = null;       // 노드 직접 선택 모드 - 출발
let pathToNodeId = null;       // 노드 직접 선택 모드 - 도착

// ===== 거리 계산 =====
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * Math.PI / 360) ** 2
        + Math.cos(p1) * Math.cos(p2) * Math.sin((lng2 - lng1) * Math.PI / 360) ** 2;
    return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

// ===== 데이터 로드 =====
Promise.all([
    fetch("http://localhost:3000/api/poi").then(r => r.json()),
    fetch("http://localhost:3000/api/edge").then(r => r.json()),
])
    .then(([dbPoiData, dbEdgeData]) => {
        allPoi = dbPoiData.map(row => {
            let parsedEntrances = [];
            if (row.entrances) {
                try {
                    parsedEntrances = typeof row.entrances === 'string' ? JSON.parse(row.entrances) : row.entrances;
                } catch (e) {
                    // 공백 제거 방어코드 추가
                    parsedEntrances = row.entrances.split(',').map(s => String(s).trim());
                }
            }

            return {
                id: row.id,
                name: row.name,
                type: row.type,
                lat: row.lat,
                lng: row.lng,
                panorama_url: row.panorama_url,
                entrances: parsedEntrances
            };
        });

        const edgeData = dbEdgeData.map(row => ({
            from: row.from,
            to: row.to,
            weight: row.weight,
            type: row.type
        }));

        buildingList = allPoi.filter(p => p.type === "building");
        nodeMap = Object.fromEntries(allPoi.map(p => [p.id, p]));

        initNodes(allPoi);
        initEdges(edgeData);
        initEdgeTypeFilters(edgeData);
        initPathSelects();

        document.getElementById("totalNode").innerText = allPoi.filter(p => p.type !== "building").length;
        document.getElementById("totalEdge").innerText = edgeData.length;
    })
    .catch(err => console.error("데이터 로드 실패:", err));

/* =============================================
   NODE
   ============================================= */
function initNodes(poi) {
    poi.forEach(p => {
        const marker = new kakao.maps.Marker({
            map, position: new kakao.maps.LatLng(p.lat, p.lng),
            image: markerImages[p.type]
        });

        kakao.maps.event.addListener(marker, "mouseover", () => {
            infowindow.setContent(
                `<div style="padding:5px;font-size:12px;">${p.name}</div>`);
            infowindow.open(map, marker);
        });
        kakao.maps.event.addListener(marker, "mouseout", () => infowindow.close());
        kakao.maps.event.addListener(marker, "click", () => selectNode(p.id));

        markers.push({ marker, type: p.type, data: p });
    });

    initNodeTypeFilters(poi);
    updateNodeMarkers();
    initSearch();
    initNodePathSearch();
}

function initNodeTypeFilters(poi) {
    const typeCounts = {};
    poi.forEach(p => { typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });
    const types = Object.keys(typeCounts);
    types.forEach(t => activeNodeTypes.add(t));

    const container = document.getElementById("nodeTypeFilters");

    // all
    const allLabel = document.createElement("label");
    allLabel.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;font-weight:bold;";
    allLabel.innerHTML = '<input type="checkbox" id="nodeAllCheck" checked> all';
    container.appendChild(allLabel);

    types.forEach(type => {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;";
        label.innerHTML = `
            <input type="checkbox" checked data-node-type="${type}">
            <span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;display:inline-block;background:${NODE_COLORS[type] || '#888'}"></span>
            ${type} (${typeCounts[type]})
        `;
        label.querySelector("input").addEventListener("change", function () {
            if (this.checked) activeNodeTypes.add(type);
            else activeNodeTypes.delete(type);
            syncAllCheck("nodeAllCheck", "input[data-node-type]");
            updateNodeMarkers();
        });
        container.appendChild(label);
    });

    document.getElementById("nodeAllCheck").addEventListener("change", function () {
        container.querySelectorAll("input[data-node-type]").forEach(cb => {
            cb.checked = this.checked;
            if (this.checked) activeNodeTypes.add(cb.dataset.nodeType);
            else activeNodeTypes.delete(cb.dataset.nodeType);
        });
        updateNodeMarkers();
    });
}

function syncAllCheck(allId, selector) {
    const allCbs = document.querySelectorAll(selector);
    document.getElementById(allId).checked = [...allCbs].every(cb => cb.checked);
}

function updatePanoBtn(id) {
    const p = nodeMap[id];
    if (!p) return;
    const btn = document.getElementById("panoBtnWrap");
    if (!btn) return;
    btn.style.display = "";
    btn.querySelector("button").onclick = () => openPanoViewer(p);
    btn.querySelector("button").textContent =
        p.panorama_url ? "🔭 360° 사진 보기" : "🔭 360° 뷰어 열기";
}

function selectNode(id) {
    selectedNodeId = id;
    nodeFilterActive = true;
    edgesVisible = true;
    const p = nodeMap[id];
    if (!p) return;

    document.getElementById("selectedNodeInfo").innerText = p.name;  // ID 제거
    document.getElementById("nodeIdInput").value = id;

    const photoInput = document.getElementById('photoPoiId');
    if (photoInput) {
        photoInput.value = id;
        const preview = document.getElementById('photoPreview');
        if (preview) preview.style.display = 'none';
    }

    const connected = polylines.filter(({ edge: e }) => e.from === id || e.to === id);
    const listEl = document.getElementById("connectedEdgeList");
    listEl.innerHTML = "";
    connected.forEach(({ edge: e }) => {
        const li = document.createElement("li");
        const fromName = nodeMap[e.from]?.name || e.from;
        const toName   = nodeMap[e.to]?.name   || e.to;
        li.textContent = `${fromName} ↔ ${toName}  |  ${e.type}  ${e.weight.toFixed(2)}m`;
        listEl.appendChild(li);
    });
    document.getElementById("connectedEdgeCount").innerText = connected.length;
    applyEdgeFilter();
    updatePanoBtn(id);
}

function clearSelection() {
    selectedNodeId = null;
    nodeFilterActive = false;
    edgesVisible = false; // 해제 시 전체 엣지 숨김 유지
    document.getElementById("selectedNodeInfo").innerText = "없음";
    document.getElementById("nodeIdInput").value = "";
    document.getElementById("connectedEdgeList").innerHTML = "";
    document.getElementById("connectedEdgeCount").innerText = 0;
    applyEdgeFilter();
}

function selectNodeById() {
    const id = document.getElementById("nodeIdInput").value.trim();
    if (!nodeMap[id]) { alert(`노드 #${id} 를 찾을 수 없습니다.`); return; }
    selectNode(id);
}

function updateNodeMarkers() {
    if (pathNodeIds.length > 0) { applyPathDisplay(); return; }
    let count = 0;
    markers.forEach(item => {
        const show = activeNodeTypes.has(item.type);
        item.marker.setMap(show ? map : null);
        if (show) count++;
    });
    document.getElementById("visibleCount").innerText = count;
}


/* =============================================
   EDGE
   ============================================= */
function createPolyline(e) {
    const from = nodeMap[e.from], to = nodeMap[e.to];
    if (!from || !to) return null;

    const pl = new kakao.maps.Polyline({
        map,
        path: [new kakao.maps.LatLng(from.lat, from.lng), new kakao.maps.LatLng(to.lat, to.lng)],
        strokeWeight: 3,
        strokeColor: EDGE_COLORS[e.type] || "#888",
        strokeOpacity: 0.85,
        strokeStyle: "solid"
    });

    kakao.maps.event.addListener(pl, "mouseover", function (ev) {
        edgeInfowindow.setContent(
            `<div style="padding:5px;font-size:12px;line-height:1.6">` +
            `<b>#${e.from}</b> ${nodeMap[e.from]?.name || ""}<br>` +
            `↕ <b>#${e.to}</b> ${nodeMap[e.to]?.name || ""}<br>` +
            `type: ${e.type} &nbsp; weight: ${e.weight}m</div>`
        );
        edgeInfowindow.setPosition(ev.latLng);
        edgeInfowindow.open(map);
    });
    kakao.maps.event.addListener(pl, "mouseout", () => edgeInfowindow.close());

    return pl;
}

function initEdges(edges) {
    edges.forEach(e => {
        const pl = createPolyline(e);
        if (pl) polylines.push({ polyline: pl, edge: e });
    });
    applyEdgeFilter();
}

function initEdgeTypeFilters(edges) {
    const types = [...new Set(edges.map(e => e.type))];
    types.forEach(t => activeEdgeTypes.add(t));

    const container = document.getElementById("edgeTypeFilters");

    const allLabel = document.createElement("label");
    allLabel.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;font-weight:bold;";
    allLabel.innerHTML = `<input type="checkbox" id="edgeAllCheck" checked> all`;
    container.appendChild(allLabel);

    types.forEach(type => {
        const count = edges.filter(e => e.type === type).length;
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;";
        label.innerHTML = `
            <input type="checkbox" checked data-edge-type="${type}">
            <span style="width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0;background:${EDGE_COLORS[type] || '#888'}"></span>
            ${type} (${count})
        `;
        label.querySelector("input").addEventListener("change", function () {
            if (this.checked) activeEdgeTypes.add(type);
            else activeEdgeTypes.delete(type);
            syncAllCheck("edgeAllCheck", "input[data-edge-type]");
            applyEdgeFilter();
        });
        container.appendChild(label);
    });

    document.getElementById("edgeAllCheck").addEventListener("change", function () {
        container.querySelectorAll("input[data-edge-type]").forEach(cb => {
            cb.checked = this.checked;
            if (this.checked) activeEdgeTypes.add(cb.dataset.edgeType);
            else activeEdgeTypes.delete(cb.dataset.edgeType);
        });
        applyEdgeFilter();
    });
}

function applyEdgeFilter() {
    let count = 0;
    polylines.forEach(({ polyline, edge: e }) => {
        const typeOk = activeEdgeTypes.has(e.type);
        const nodeOk = !nodeFilterActive || e.from === selectedNodeId || e.to === selectedNodeId;
        const show = edgesVisible && typeOk && nodeOk;
        polyline.setMap(show ? map : null);
        if (show) count++;
    });
    document.getElementById("visibleEdgeCount").innerText = count;
}

function toggleEdges(show) {
    edgesVisible = show;
    if (nodeFilterActive) clearSelection();
    else applyEdgeFilter();
}


/* =============================================
   JSON 내보내기
   ============================================= */
function exportJSON() {
    const json = JSON.stringify(polylines.map(({ edge }) => edge), null, 2);
    const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([json], { type: "application/json" })),
        download: "edge.json"
    });
    a.click();
}


/* =============================================
   검증
   ============================================= */
function clearHighlight() {
    highlightMarkers.forEach(m => m.setMap(null));
    highlightMarkers = [];
    markers.forEach(item => {
        if (activeNodeTypes.has(item.type)) item.marker.setMap(map);
    });
    setValidationResult("", "");
}

function setValidationResult(msg, level) {
    const el = document.getElementById("validationResult");
    el.className = level ? `v-${level}` : "";
    el.innerText = msg;
}

function checkIsolated() {
    clearHighlight();
    const connected = new Set();
    polylines.forEach(({ edge: e }) => { connected.add(e.from); connected.add(e.to); });

    const isolated = markers.filter(item =>
        item.data.type !== "building" && !connected.has(item.data.id));

    if (isolated.length === 0) { setValidationResult("✅ 고립 노드 없음", "ok"); return; }

    isolated.forEach(item => {
        item.marker.setMap(null);
        const hm = new kakao.maps.Marker({
            map, position: item.marker.getPosition(), image: isolatedImage, zIndex: 10
        });
        const iw = new kakao.maps.InfoWindow({ removable: false });
        kakao.maps.event.addListener(hm, "mouseover", () => {
            iw.setContent(`<div style="padding:4px 8px;font-size:12px;color:red"><b>고립</b> #${item.data.id} ${item.data.name}</div>`);
            iw.open(map, hm);
        });
        kakao.maps.event.addListener(hm, "mouseout", () => iw.close());
        highlightMarkers.push(hm);
    });

    setValidationResult(
        `❌ 고립 노드 ${isolated.length}개: ${isolated.map(i => `#${i.data.id}`).join(", ")}`, "err");
}

function checkDuplicates() {
    clearHighlight();
    const seen = new Set(), dups = [];
    polylines.forEach(({ edge: e }) => {
        const key = `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`;
        if (seen.has(key)) dups.push(e);
        else seen.add(key);
    });

    if (dups.length === 0) { setValidationResult("✅ 중복 엣지 없음", "ok"); return; }

    dups.forEach(e => {
        const f = nodeMap[e.from], t = nodeMap[e.to];
        if (!f || !t) return;
        const hl = new kakao.maps.Polyline({
            map,
            path: [new kakao.maps.LatLng(f.lat, f.lng), new kakao.maps.LatLng(t.lat, t.lng)],
            strokeWeight: 6, strokeColor: "#ff0000", strokeOpacity: 1, zIndex: 10
        });
        highlightMarkers.push({ setMap: m => hl.setMap(m) });
    });

    setValidationResult(
        `⚠️ 중복 ${dups.length}개: ${dups.map(e => `#${e.from}↔#${e.to}`).join(", ")}`, "warn");
}


/* =============================================
   경로 테스트
   ============================================= */
function initPathSelects() {
    const selFrom = document.getElementById("pathFromBuilding");
    const selTo = document.getElementById("pathToBuilding");

    // 빈 기본 옵션
    selFrom.innerHTML = `<option value="">건물 선택</option>`;
    selTo.innerHTML = `<option value="">건물 선택</option>`;

    buildingList.forEach(b => {
        selFrom.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        selTo.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
}

function onBuildingSelectChange(side) {
    const buildingSelId = side === "from" ? "pathFromBuilding" : "pathToBuilding";
    const entranceRowId = side === "from" ? "pathFromEntranceRow" : "pathToEntranceRow";
    const entranceSelId = side === "from" ? "pathFromEntrance" : "pathToEntrance";

    const buildingId = document.getElementById(buildingSelId).value;
    const entranceRow = document.getElementById(entranceRowId);
    const entranceSel = document.getElementById(entranceSelId);

    entranceSel.innerHTML = "";

    if (!buildingId) {
        entranceRow.style.display = "none";
        return;
    }

    const building = buildingList.find(b => b.id === buildingId);
    if (!building) { entranceRow.style.display = "none"; return; }

    // DB에 등록된 입구 목록
    let entranceIds = building.entrances && building.entrances.length > 0
        ? building.entrances
        : [];

    // 등록된 입구가 없으면 가장 가까운 entrance 노드 1개를 자동으로
    if (entranceIds.length === 0) {
        const nearest = findNearestNode(building.lat, building.lng, "entrance");
        if (nearest) entranceIds = [nearest.id];
    }

    if (entranceIds.length === 0) {
        // 입구가 전혀 없으면 드롭다운 숨기고 건물 자체 사용
        entranceRow.style.display = "none";
        return;
    }

    // "자동 선택" 옵션 (기존 findPathBuilding 로직과 동일하게 최단 경로)
    entranceSel.innerHTML = `<option value="auto">자동 선택 (최단)</option>`;

    entranceIds.forEach(eid => {
        const node = nodeMap[eid];
        if (!node) return;
        entranceSel.innerHTML += `<option value="${eid}"> ${node.name}</option>`;
    });

    entranceRow.style.display = "";
}

// 탭 전환
function switchPathTab(tab) {
    pathTab = tab;
    document.getElementById("tabBuilding").classList.toggle("active", tab === "building");
    document.getElementById("tabNode").classList.toggle("active", tab === "node");
    document.getElementById("modeBuilding").style.display = tab === "building" ? "" : "none";
    document.getElementById("modeNode").style.display = tab === "node" ? "" : "none";
}

// 노드 직접 선택 — 자동완성
function initNodePathSearch() {
    setupNodeAutocomplete(
        document.getElementById("pathFromNodeInput"),
        document.getElementById("pathFromList"),
        id => {
            pathFromNodeId = id;
            document.getElementById("pathFromNodeId").textContent = `#${id} ${nodeMap[id]?.name || ""}`;
        }
    );
    setupNodeAutocomplete(
        document.getElementById("pathToNodeInput"),
        document.getElementById("pathToList"),
        id => {
            pathToNodeId = id;
            document.getElementById("pathToNodeId").textContent = `#${id} ${nodeMap[id]?.name || ""}`;
        }
    );
}

function setupNodeAutocomplete(input, list, onSelect) {
    input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase();
        list.innerHTML = "";
        if (!q) { list.style.display = "none"; return; }

        const results = allPoi
            .filter(p => p.type !== "building")
            .filter(p => String(p.id).includes(q) || p.name.toLowerCase().includes(q))
            .slice(0, 20);

        if (results.length === 0) { list.style.display = "none"; return; }

        results.forEach(p => {
            const li = document.createElement("li");
            li.innerHTML = `<span style="color:#999;margin-right:4px;">#${p.id}</span>${p.name}`;
            li.addEventListener("click", () => {
                input.value = `#${p.id} ${p.name}`;
                list.style.display = "none";
                onSelect(p.id);
            });
            list.appendChild(li);
        });
        list.style.display = "block";
    });

    document.addEventListener("click", e => {
        if (!e.target.closest(".node-search-wrap")) list.style.display = "none";
    });
}

// Dijkstra
function dijkstra(startId, endId, edges, wheelchair) {
    const filtered = wheelchair ? edges.filter(e => e.type !== "stair") : edges;

    const graph = {};
    filtered.forEach(e => {
        if (!graph[e.from]) graph[e.from] = [];
        if (!graph[e.to]) graph[e.to] = [];
        graph[e.from].push({ node: e.to, weight: e.weight });
        graph[e.to].push({ node: e.from, weight: e.weight });
    });

    const dist = {}, prev = {}, visited = new Set();
    Object.keys(graph).forEach(n => dist[n] = Infinity);
    dist[startId] = 0;
    const queue = [[0, startId]];

    while (queue.length) {
        queue.sort((a, b) => a[0] - b[0]);
        const [d, u] = queue.shift();
        if (visited.has(String(u))) continue;
        visited.add(String(u));
        if (String(u) === String(endId)) break;
        for (const { node: v, weight } of graph[u] || []) {
            const nd = d + weight;
            if (nd < (dist[v] ?? Infinity)) {
                dist[v] = nd; prev[v] = u; queue.push([nd, v]);
            }
        }
    }

    if (!isFinite(dist[endId])) return null;
    const path = [];
    let cur = endId;
    while (cur !== undefined) { path.unshift(String(cur)); cur = prev[cur]; }
    return { path, distance: Math.round(dist[endId]) };
}

// 💡 [신규 추가] 좌표 기반으로 가장 가까운 특정 타입의 노드 찾기
function findNearestNode(lat, lng, targetType) {
    let minDist = Infinity;
    let nearest = null;
    allPoi.forEach(p => {
        if (p.type === targetType) {
            // 기존에 만들어둔 하버사인 거리 계산 함수 재활용!
            const d = haversine(lat, lng, p.lat, p.lng);
            if (d < minDist) { minDist = d; nearest = p; }
        }
    });
    return nearest;
}

//  건물 간 경로 찾기
function findPathBuilding(fromB, toB, edges, wheelchair) {
    let best = null;

    // 1. DB에서 받은 입구 배열 확인
    let fromEntrances = fromB.entrances && fromB.entrances.length > 0 ? fromB.entrances : [];
    let toEntrances = toB.entrances && toB.entrances.length > 0 ? toB.entrances : [];

    // 2. DB에 입구 데이터가 없다면? -> 가장 가까운 'entrance(입구)' 노드를 자동으로 찾아서 연결!
    if (fromEntrances.length === 0) {
        const nearest = findNearestNode(fromB.lat, fromB.lng, "entrance");
        if (nearest) fromEntrances.push(nearest.id);
        else fromEntrances.push(fromB.id); // 혹시 주변에 입구가 아예 없으면 자기 자신 반환
    }
    if (toEntrances.length === 0) {
        const nearest = findNearestNode(toB.lat, toB.lng, "entrance");
        if (nearest) toEntrances.push(nearest.id);
        else toEntrances.push(toB.id);
    }

    // 3. 다익스트라 경로 탐색
    for (const s of fromEntrances) {
        for (const e of toEntrances) {
            const r = dijkstra(s, e, edges, wheelchair);
            if (r && (!best || r.distance < best.distance)) {
                best = { ...r, fromEntrance: s, toEntrance: e };
            }
        }
    }

    return best;
}

function runPathTest() {
    clearPathTest();

    const wheelchair = document.getElementById("wheelchairMode").checked;
    const edges = polylines.map(({ edge }) => edge);
    const resultEl = document.getElementById("pathResult");
    let result = null;
    let labelFrom = "", labelTo = "";

    if (pathTab === "building") {
        const fromId = document.getElementById("pathFromBuilding").value;
        const toId = document.getElementById("pathToBuilding").value;
        if (!fromId || !toId) { resultEl.textContent = "출발지와 도착지를 모두 선택하세요."; return; }
        if (fromId === toId) { resultEl.textContent = "출발지와 도착지가 같습니다."; return; }

        const fromB = buildingList.find(b => b.id === fromId);
        const toB = buildingList.find(b => b.id === toId);

        // 입구 드롭다운 선택값 읽기
        const fromEntranceSel = document.getElementById("pathFromEntrance");
        const toEntranceSel = document.getElementById("pathToEntrance");
        const fromEntranceVal = fromEntranceSel ? fromEntranceSel.value : "auto";
        const toEntranceVal = toEntranceSel ? toEntranceSel.value : "auto";

        if (fromEntranceVal !== "auto" || toEntranceVal !== "auto") {
            // 하나라도 수동 지정 시 — 고정 출발/도착 입구로 다익스트라
            let fromEntrances = fromEntranceVal === "auto"
                ? (fromB.entrances?.length ? fromB.entrances : (() => { const n = findNearestNode(fromB.lat, fromB.lng, "entrance"); return n ? [n.id] : [fromB.id]; })())
                : [fromEntranceVal];
            let toEntrances = toEntranceVal === "auto"
                ? (toB.entrances?.length ? toB.entrances : (() => { const n = findNearestNode(toB.lat, toB.lng, "entrance"); return n ? [n.id] : [toB.id]; })())
                : [toEntranceVal];

            let best = null;
            for (const s of fromEntrances) {
                for (const e of toEntrances) {
                    const r = dijkstra(s, e, edges, wheelchair);
                    if (r && (!best || r.distance < best.distance)) best = { ...r, fromEntrance: s, toEntrance: e };
                }
            }
            result = best;
        } else {
            result = findPathBuilding(fromB, toB, edges, wheelchair);
        }

        labelFrom = fromB.name;
        labelTo = toB.name;
    } else {
        // 노드 직접 선택
        if (!pathFromNodeId || !pathToNodeId) {
            resultEl.textContent = "출발/도착 노드를 모두 선택하세요."; return;
        }
        if (pathFromNodeId === pathToNodeId) {
            resultEl.textContent = "출발지와 도착지가 같습니다."; return;
        }
        result = dijkstra(pathFromNodeId, pathToNodeId, edges, wheelchair);
        labelFrom = `#${pathFromNodeId} ${nodeMap[pathFromNodeId]?.name || ""}`;
        labelTo = `#${pathToNodeId} ${nodeMap[pathToNodeId]?.name || ""}`;
    }

    if (!result) {
        resultEl.textContent = wheelchair
            ? "❌ 휠체어 접근 가능한 경로가 없습니다."
            : "❌ 두 지점 사이에 연결된 경로가 없습니다.";
        return;
    }

    pathNodeIds = result.path;

    resultEl.innerHTML =
        `✅ <b>${labelFrom}</b> → <b>${labelTo}</b><br>` +
        `총 거리: <b>${result.distance}m</b> &nbsp; 노드: <b>${result.path.length}개</b>`;

    // 경로 폴리라인
    const linePath = result.path.map(id => nodeMap[id]).filter(Boolean)
        .map(n => new kakao.maps.LatLng(n.lat, n.lng));

    pathPolyline = new kakao.maps.Polyline({
        map, path: linePath,
        strokeWeight: 5,
        strokeColor: wheelchair ? "#f97316" : "#2563eb",
        strokeOpacity: 0.9,
        zIndex: 5
    });

    // 경로 노드 목록
    const listEl = document.getElementById("pathNodeList");
    listEl.innerHTML = "";
    result.path.forEach((id, i) => {
        const n = nodeMap[id];
        if (!n) return;
        const li = document.createElement("li");
        li.textContent = `#${id} ${n.name}`;
        if (i === 0) li.className = "start";
        if (i === result.path.length - 1) li.className = "end";
        listEl.appendChild(li);
    });

    // 지도 범위 조정
    const bounds = new kakao.maps.LatLngBounds();
    linePath.forEach(p => bounds.extend(p));
    map.setBounds(bounds, 40);

    applyPathDisplay();
    initPathStepViewer();
}

function clearPathTest() {
    if (pathPolyline) { pathPolyline.setMap(null); pathPolyline = null; }
    pathNodeIds = [];
    document.getElementById("pathResult").textContent = "경로를 선택하세요.";
    document.getElementById("pathNodeList").innerHTML = "";
    updateNodeMarkers();
    clearPathStepViewer();
}

function onPathDisplayChange() {
    pathDisplay = document.querySelector("input[name='pathDisplay']:checked").value;
    if (pathNodeIds.length > 0) applyPathDisplay();
    else updateNodeMarkers();
}

function applyPathDisplay() {
    const pathSet = new Set(pathNodeIds);
    let count = 0;
    markers.forEach(item => {
        let show = false;
        if (pathDisplay === "all") show = activeNodeTypes.has(item.type);
        else if (pathDisplay === "path") show = pathSet.has(item.data.id);
        else if (pathDisplay === "filter") show = activeNodeTypes.has(item.type) && pathSet.has(item.data.id);
        item.marker.setMap(show ? map : null);
        if (show) count++;
    });
    document.getElementById("visibleCount").innerText = count;
}


/* =============================================
   검색
   ============================================= */
function initSearch() {
    const searchInput = document.getElementById("searchInput");
    const searchList = document.getElementById("searchList");

    function runSearch() {
        const query = searchInput.value.trim().toLowerCase();
        searchList.innerHTML = "";
        if (!query) { searchList.style.display = "none"; return; }

        const results = allPoi.filter(p =>
            p.name.toLowerCase().includes(query));

        if (results.length === 0) {
            searchList.innerHTML = "<li style='padding:8px;color:#999;'>검색 결과 없음</li>";
            searchList.style.display = "block"; return;
        }

        results.forEach(p => {
            const li = document.createElement("li");
            li.innerHTML = p.name;
            li.addEventListener("click", () => {
                searchInfowindow.close();
                const target = markers.find(m => m.data.id === p.id);
                if (target) {
                    searchInfowindow.setContent(
                        `<div style="padding:6px 10px;font-size:12px;"><b>#${p.id}</b> ${p.name}</div>`);
                    searchInfowindow.open(map, target.marker);
                }
                searchInput.value = p.name;
                searchList.style.display = "none";
            });
            searchList.appendChild(li);
        });
        searchList.style.display = "block";
    }

    searchInput.addEventListener("input", runSearch);
    searchInput.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
    document.addEventListener("click", e => {
        if (!e.target.closest("#searchWrapper")) searchList.style.display = "none";
    });
}

/* =============================================
   파노라마
   ============================================= */

// 파노라마 뷰어 상태
let panoRenderer = null;
let panoScene = null;
let panoCamera = null;
let panoAnimId = null;
let panoDragging = false;
let panoLon = 0, panoLat = 0;
let panoStartX = 0, panoStartY = 0;
let panoStartLon = 0, panoStartLat = 0;

// 방향 컷 상태
let dirCutCanvas = null;
let dirCutCtx = null;
let dirCutImg = null;
let dirCutUrl = null;

/* --------------------------------------------------
   1. 방향각 계산 (두 노드 사이 bearing, 0~360°)
-------------------------------------------------- */
function getBearing(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
        - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/* --------------------------------------------------
   2. equirectangular 이미지에서 방향 컷 추출
   bearing: 0~360° (북=0, 동=90, 남=180, 서=270)
   fovH: 수평 시야각 (기본 90°)
   ratio: 출력 비율 (4:3)
-------------------------------------------------- */
function extractDirectionCut(img, bearing, fovH = 90) {
    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;

    // 4:3 비율로 출력 크기 결정
    const outW = Math.min(srcW * (fovH / 360), srcW);
    const outH = outW * (3 / 4);

    // 출력 canvas
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const outCtx = out.getContext("2d");

    // bearing → x 오프셋 (equirectangular: x = bearing/360 * width)
    const centerX = (bearing / 360) * srcW;
    const halfW = outW / 2;

    // 수직 중앙 (지평선 기준 약간 위)
    const centerY = srcH * 0.45;
    const halfH = outH / 2;

    const srcX = centerX - halfW;
    const srcY = centerY - halfH;

    if (srcX >= 0 && srcX + outW <= srcW) {
        // 이음새 없는 경우
        outCtx.drawImage(img, srcX, srcY, outW, outH, 0, 0, outW, outH);
    } else {
        // 이음새 걸치는 경우 (0°/360° 경계)
        const leftW = srcW - ((srcX + srcW) % srcW);
        const rightW = outW - leftW;
        outCtx.drawImage(img, (srcX + srcW) % srcW, srcY, leftW, outH, 0, 0, leftW, outH);
        outCtx.drawImage(img, 0, srcY, rightW, outH, leftW, 0, rightW, outH);
    }

    return out.toDataURL("image/jpeg", 0.92);
}

/* --------------------------------------------------
   3. 길찾기 경로 스텝별 방향 컷 표시
   pathNodeIds: 경로 노드 ID 배열 (graphManager2.js 전역)
   stepIndex: 현재 보여줄 스텝 (0 = 첫 노드)
-------------------------------------------------- */
let currentPathStep = 0;

function showPathStep(stepIndex) {
    if (!pathNodeIds || pathNodeIds.length < 2) return;
    stepIndex = Math.max(0, Math.min(stepIndex, pathNodeIds.length - 2));
    currentPathStep = stepIndex;

    const fromNode = nodeMap[pathNodeIds[stepIndex]];
    const toNode = nodeMap[pathNodeIds[stepIndex + 1]];
    if (!fromNode || !toNode) return;

    // 스텝 UI 업데이트
    document.getElementById("pathStepLabel").textContent =
        `${stepIndex + 1} / ${pathNodeIds.length - 1} 스텝`;
    document.getElementById("pathStepFrom").textContent =
        `📍 #${fromNode.id} ${fromNode.name}`;
    document.getElementById("pathStepTo").textContent =
        `→ #${toNode.id} ${toNode.name}`;

    const bearing = getBearing(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng);

    const dirImg = document.getElementById("dirCutImg");
    const dirNotice = document.getElementById("dirCutNotice");
    const panoBtn = document.getElementById("pathPanoBtn");

    // 파노 버튼: fromNode에 사진 있으면 활성화
    if (fromNode.panorama_url) {
        panoBtn.style.display = "";
        panoBtn.onclick = () => openPanoViewerWithBearing(fromNode, bearing);
    } else {
        panoBtn.style.display = "none";
    }

    if (!fromNode.panorama_url) {
        dirImg.style.display = "none";
        dirNotice.style.display = "";
        dirNotice.textContent = "📷 이 노드에는 사진이 없습니다.";
        return;
    }

    dirNotice.style.display = "";
    dirNotice.textContent = "⏳ 사진 불러오는 중...";
    dirImg.src = "";

    // 이미지 로드 (같은 URL이면 캐시 재사용)
    function renderCut(img) {
        const dataUrl = extractDirectionCut(img, bearing);
        dirImg.src = dataUrl;
        dirNotice.style.display = "none";

        // 방향 화살표 오버레이 업데이트
        document.getElementById("dirArrow").textContent = bearingToArrow(bearing);
        document.getElementById("dirDegree").textContent =
            `${Math.round(bearing)}° ${bearingToLabel(bearing)}`;
    }

    if (dirCutUrl === fromNode.panorama_url && dirCutImg) {
        renderCut(dirCutImg);
    } else {
        dirCutImg = new Image();
        dirCutImg.crossOrigin = "anonymous";
        dirCutImg.onload = () => { dirCutUrl = fromNode.panorama_url; renderCut(dirCutImg); };
        dirCutImg.onerror = () => {
            dirNotice.textContent = "⚠ 이미지를 불러올 수 없습니다.";
        };
        dirCutImg.src = 'http://localhost:3000' + fromNode.panorama_url;
    }
}

function bearingToArrow(b) {
    const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖", "↑"];
    return arrows[Math.round(b / 45) % 8];
}
function bearingToLabel(b) {
    const labels = ["북", "북동", "동", "남동", "남", "남서", "서", "북서", "북"];
    return labels[Math.round(b / 45) % 8];
}

function prevPathStep() { showPathStep(currentPathStep - 1); }
function nextPathStep() { showPathStep(currentPathStep + 1); }

/* --------------------------------------------------
   4. 파노라마 뷰어 (bearing 초기 시점 포함)
-------------------------------------------------- */
function initPanoViewer() {
    const canvas = document.getElementById("panoCanvas");
    if (!canvas || panoRenderer) return;

    panoRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    panoScene = new THREE.Scene();
    panoCamera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    panoCamera.position.set(0, 0, 0.01);

    const geo = new THREE.SphereGeometry(500, 60, 40);
    geo.scale(-1, 1, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x111111 }));
    mesh.name = "panosphere";
    panoScene.add(mesh);

    resizePanoRenderer();

    canvas.addEventListener("mousedown", onPanoPointerDown);
    canvas.addEventListener("mousemove", onPanoPointerMove);
    canvas.addEventListener("mouseup", onPanoPointerUp);
    canvas.addEventListener("mouseleave", onPanoPointerUp);
    canvas.addEventListener("touchstart", onPanoTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onPanoTouchMove, { passive: false });
    canvas.addEventListener("touchend", onPanoPointerUp);
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        panoCamera.fov = Math.min(110, Math.max(30, panoCamera.fov + e.deltaY * 0.05));
        panoCamera.updateProjectionMatrix();
    }, { passive: false });
}

function resizePanoRenderer() {
    const canvas = document.getElementById("panoCanvas");
    if (!canvas || !panoRenderer) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    panoRenderer.setSize(w, h, false);
    if (panoCamera) { panoCamera.aspect = w / h; panoCamera.updateProjectionMatrix(); }
}

// 노드 단독 뷰어 (기존)
function openPanoViewer(node) {
    openPanoViewerWithBearing(node, 0);
}

// bearing 초기 시점 지정 뷰어
function openPanoViewerWithBearing(node, bearing) {
    console.log('panorama_url:', node.panorama_url);
    const overlay = document.getElementById("panoOverlay");
    document.getElementById("panoTitle").textContent = `#${node.id} ${node.name}`;
    overlay.style.display = "flex";

    if (!panoRenderer) initPanoViewer();
    resizePanoRenderer();

    // bearing을 lon으로 변환 (equirectangular: 북=0 → lon=0이 동쪽이므로 -90 보정)
    panoLon = bearing - 90;
    panoLat = 0;
    panoCamera.fov = 75;
    panoCamera.updateProjectionMatrix();

    const mesh = panoScene.getObjectByName("panosphere");
    const notice = document.getElementById("panoNotice");

    if (node.panorama_url) {
        notice.style.display = "none";
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const loader = new THREE.TextureLoader();
        loader.load(
            'http://localhost:3000' + node.panorama_url,
            (tex) => {
                mesh.material = new THREE.MeshBasicMaterial({ map: tex });
            },
            undefined,
            () => { notice.textContent = '⚠ 이미지를 불러올 수 없습니다.'; notice.style.display = 'block'; }
        );
    } else {
        mesh.material = new THREE.MeshBasicMaterial({ color: 0x1a1a2e, wireframe: true });
        notice.textContent = "📷 이 노드에는 아직 파노라마 사진이 없습니다.";
        notice.style.display = "block";
    }

    if (panoAnimId) cancelAnimationFrame(panoAnimId);
    renderPano();
}

function closePanoViewer() {
    document.getElementById("panoOverlay").style.display = "none";
    if (panoAnimId) { cancelAnimationFrame(panoAnimId); panoAnimId = null; }
}

function renderPano() {
    panoAnimId = requestAnimationFrame(renderPano);
    panoLat = Math.max(-85, Math.min(85, panoLat));
    const phi = THREE.MathUtils.degToRad(90 - panoLat);
    const theta = THREE.MathUtils.degToRad(panoLon);
    panoCamera.lookAt(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
    );
    panoRenderer.render(panoScene, panoCamera);
}

function onPanoPointerDown(e) {
    panoDragging = true;
    panoStartX = e.clientX; panoStartY = e.clientY;
    panoStartLon = panoLon; panoStartLat = panoLat;
}
function onPanoPointerMove(e) {
    if (!panoDragging) return;
    panoLon = panoStartLon - (e.clientX - panoStartX) * 0.2;
    panoLat = panoStartLat + (e.clientY - panoStartY) * 0.2;
}
function onPanoPointerUp() { panoDragging = false; }
function onPanoTouchStart(e) {
    if (e.touches.length !== 1) return;
    panoDragging = true;
    panoStartX = e.touches[0].clientX; panoStartY = e.touches[0].clientY;
    panoStartLon = panoLon; panoStartLat = panoLat;
}
function onPanoTouchMove(e) {
    if (!panoDragging || e.touches.length !== 1) return;
    e.preventDefault();
    panoLon = panoStartLon - (e.touches[0].clientX - panoStartX) * 0.2;
    panoLat = panoStartLat + (e.touches[0].clientY - panoStartY) * 0.2;
}

/* --------------------------------------------------
   5. 노드 선택 시 파노 버튼 (기존 기능 유지)
-------------------------------------------------- */
function updatePanoBtn(id) {
    const p = nodeMap[id];
    const btn = document.getElementById("panoBtnWrap");
    if (!p || !btn) return;
    btn.style.display = "";
    btn.querySelector("button").onclick = () => openPanoViewer(p);
    btn.querySelector("button").textContent =
        p.panorama_url ? "🔭 360° 사진 보기" : "🔭 360° 뷰어 열기";
}

/* --------------------------------------------------
   6. 경로 찾기 완료 후 스텝 뷰어 초기화
   graphManager2.js의 runPathTest() 안에서
   경로 표시 완료 후 아래를 호출하세요:
     initPathStepViewer();
-------------------------------------------------- */
function initPathStepViewer() {
    if (!pathNodeIds || pathNodeIds.length < 2) return;
    document.getElementById("dirPanel").style.display = "";
    currentPathStep = 0;
    showPathStep(0);
}

function clearPathStepViewer() {
    document.getElementById("dirPanel").style.display = "none";
    dirCutImg = null;
    dirCutUrl = null;
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanoViewer(); });
window.addEventListener("resize", resizePanoRenderer);

/*--------------------------------------------------
    파노라마 창 최소화, 닫기
-------------------------------------------------- */
let dirPanelMinimized = false;


function closeDirPanel() {
    document.getElementById('dirPanel').style.display = 'none';
}