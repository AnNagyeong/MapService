/* =============================================
   캠퍼스 관리자 페이지
   ============================================= */

// ===== 지도 초기화 =====
var map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(37.55843493, 127.04983095),
    level: 3
});

const imageSize    = new kakao.maps.Size(32, 32);
const isolatedSize = new kakao.maps.Size(38, 38);
const isolatedImage = new kakao.maps.MarkerImage("../images/redMarker.png", isolatedSize);

const markerImages = {
    entrance:  new kakao.maps.MarkerImage("../images/blueMarker.png",   imageSize),
    ramp:      new kakao.maps.MarkerImage("../images/greenMarker.png",  imageSize),
    stair:     new kakao.maps.MarkerImage("../images/redMarker.png",    imageSize),
    elevator:  new kakao.maps.MarkerImage("../images/orangeMarker.png", imageSize),
    crosswalk: new kakao.maps.MarkerImage("../images/pinkMarker.png",   imageSize),
    path:      new kakao.maps.MarkerImage("../images/greyMarker.png",   imageSize),
    building:  new kakao.maps.MarkerImage("../images/yellowMarker.png", imageSize)
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
var infowindow       = new kakao.maps.InfoWindow({ removable: false });
var searchInfowindow = new kakao.maps.InfoWindow({ removable: true });
var edgeInfowindow   = new kakao.maps.InfoWindow({ removable: false });

// ===== 전역 상태 =====
let allPoi = [], markers = [], polylines = [], nodeMap = {}, buildingList = [];

let selectedNodeId   = null;
let edgesVisible     = true;
let nodeFilterActive = false;
let activeNodeTypes  = new Set();
let activeEdgeTypes  = new Set();
let highlightMarkers = [];

// 경로 테스트
let pathPolyline = null;
let pathNodeIds  = [];
let pathDisplay  = "all";
let pathTab      = "building";   // "building" | "node"
let pathFromNodeId = null;       // 노드 직접 선택 모드 - 출발
let pathToNodeId   = null;       // 노드 직접 선택 모드 - 도착

// ===== 거리 계산 =====
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const a = Math.sin((lat2-lat1)*Math.PI/360)**2
            + Math.cos(p1)*Math.cos(p2)*Math.sin((lng2-lng1)*Math.PI/360)**2;
    return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

// ===== 데이터 로드 =====
Promise.all([
    fetch("../data/poi.json").then(r => r.json()),
    fetch("../data/edge.json").then(r => r.json()),
])
.then(([poiData, edgeData]) => {
    allPoi       = poiData;
    buildingList = poiData.filter(p => p.type === "building");
    nodeMap      = Object.fromEntries(poiData.map(p => [p.id, p]));

    initNodes(poiData);
    initEdges(edgeData);
    initEdgeTypeFilters(edgeData);
    initPathSelects();

    document.getElementById("totalNode").innerText = poiData.filter(p => p.type !== "building").length;
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
                `<div style="padding:5px;font-size:12px;">ID: ${p.id}<br>${p.name}</div>`);
            infowindow.open(map, marker);
        });
        kakao.maps.event.addListener(marker, "mouseout", () => infowindow.close());
        kakao.maps.event.addListener(marker, "click",    () => selectNode(p.id));

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
            <span style="width:10px;height:10px;border-radius:50%;flex-shrink:0;display:inline-block;background:${NODE_COLORS[type]||'#888'}"></span>
            ${type} (${typeCounts[type]})
        `;
        label.querySelector("input").addEventListener("change", function () {
            if (this.checked) activeNodeTypes.add(type);
            else              activeNodeTypes.delete(type);
            syncAllCheck("nodeAllCheck", "input[data-node-type]");
            updateNodeMarkers();
        });
        container.appendChild(label);
    });

    document.getElementById("nodeAllCheck").addEventListener("change", function () {
        container.querySelectorAll("input[data-node-type]").forEach(cb => {
            cb.checked = this.checked;
            if (this.checked) activeNodeTypes.add(cb.dataset.nodeType);
            else              activeNodeTypes.delete(cb.dataset.nodeType);
        });
        updateNodeMarkers();
    });
}

function syncAllCheck(allId, selector) {
    const allCbs = document.querySelectorAll(selector);
    document.getElementById(allId).checked = [...allCbs].every(cb => cb.checked);
}

function selectNode(id) {
    selectedNodeId   = id;
    nodeFilterActive = true;
    edgesVisible     = true;
    const p = nodeMap[id];
    if (!p) return;

    document.getElementById("selectedNodeInfo").innerText = `#${id} ${p.name}`;
    document.getElementById("nodeIdInput").value = id;

    const connected = polylines.filter(({ edge: e }) => e.from === id || e.to === id);
    const listEl = document.getElementById("connectedEdgeList");
    listEl.innerHTML = "";
    connected.forEach(({ edge: e }) => {
        const li = document.createElement("li");
        li.textContent = `#${e.from}↔#${e.to}  ${e.type}  ${e.weight}m`;
        listEl.appendChild(li);
    });
    document.getElementById("connectedEdgeCount").innerText = connected.length;
    applyEdgeFilter();
}

function clearSelection() {
    selectedNodeId   = null;
    nodeFilterActive = false;
    edgesVisible     = false; // 해제 시 전체 엣지 숨김 유지
    document.getElementById("selectedNodeInfo").innerText = "없음";
    document.getElementById("nodeIdInput").value = "";
    document.getElementById("connectedEdgeList").innerHTML = "";
    document.getElementById("connectedEdgeCount").innerText = 0;
    applyEdgeFilter();
}

function selectNodeById() {
    const id = Number(document.getElementById("nodeIdInput").value);
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
            <span style="width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0;background:${EDGE_COLORS[type]||'#888'}"></span>
            ${type} (${count})
        `;
        label.querySelector("input").addEventListener("change", function () {
            if (this.checked) activeEdgeTypes.add(type);
            else              activeEdgeTypes.delete(type);
            syncAllCheck("edgeAllCheck", "input[data-edge-type]");
            applyEdgeFilter();
        });
        container.appendChild(label);
    });

    document.getElementById("edgeAllCheck").addEventListener("change", function () {
        container.querySelectorAll("input[data-edge-type]").forEach(cb => {
            cb.checked = this.checked;
            if (this.checked) activeEdgeTypes.add(cb.dataset.edgeType);
            else              activeEdgeTypes.delete(cb.dataset.edgeType);
        });
        applyEdgeFilter();
    });
}

function applyEdgeFilter() {
    let count = 0;
    polylines.forEach(({ polyline, edge: e }) => {
        const typeOk = activeEdgeTypes.has(e.type);
        const nodeOk = !nodeFilterActive || e.from === selectedNodeId || e.to === selectedNodeId;
        const show   = edgesVisible && typeOk && nodeOk;
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
        const key = `${Math.min(e.from,e.to)}-${Math.max(e.from,e.to)}`;
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
    const selTo   = document.getElementById("pathToBuilding");
    buildingList.forEach(b => {
        selFrom.innerHTML += `<option value="${b.id}">${b.name}</option>`;
        selTo.innerHTML   += `<option value="${b.id}">${b.name}</option>`;
    });
    if (selTo.options.length > 1) selTo.selectedIndex = 1;
}

// 탭 전환
function switchPathTab(tab) {
    pathTab = tab;
    document.getElementById("tabBuilding").classList.toggle("active", tab === "building");
    document.getElementById("tabNode").classList.toggle("active",     tab === "node");
    document.getElementById("modeBuilding").style.display = tab === "building" ? "" : "none";
    document.getElementById("modeNode").style.display     = tab === "node"     ? "" : "none";
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
        if (!graph[e.to])   graph[e.to]   = [];
        graph[e.from].push({ node: e.to,   weight: e.weight });
        graph[e.to].push  ({ node: e.from, weight: e.weight });
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
    while (cur !== undefined) { path.unshift(Number(cur)); cur = prev[cur]; }
    return { path, distance: Math.round(dist[endId]) };
}

// 건물 간 경로 (입구 조합 중 최단)
function findPathBuilding(fromB, toB, edges, wheelchair) {
    let best = null;
    for (const s of fromB.entrances) {
        for (const e of toB.entrances) {
            const r = dijkstra(s, e, edges, wheelchair);
            if (r && (!best || r.distance < best.distance))
                best = { ...r, fromEntrance: s, toEntrance: e };
        }
    }
    return best;
}

function runPathTest() {
    clearPathTest();

    const wheelchair = document.getElementById("wheelchairMode").checked;
    const edges      = polylines.map(({ edge }) => edge);
    const resultEl   = document.getElementById("pathResult");
    let result       = null;
    let labelFrom    = "", labelTo = "";

    if (pathTab === "building") {
        const fromId = Number(document.getElementById("pathFromBuilding").value);
        const toId   = Number(document.getElementById("pathToBuilding").value);
        if (fromId === toId) { resultEl.textContent = "출발지와 도착지가 같습니다."; return; }
        const fromB = buildingList.find(b => b.id === fromId);
        const toB   = buildingList.find(b => b.id === toId);
        result   = findPathBuilding(fromB, toB, edges, wheelchair);
        labelFrom = fromB.name;
        labelTo   = toB.name;
    } else {
        // 노드 직접 선택
        if (!pathFromNodeId || !pathToNodeId) {
            resultEl.textContent = "출발/도착 노드를 모두 선택하세요."; return;
        }
        if (pathFromNodeId === pathToNodeId) {
            resultEl.textContent = "출발지와 도착지가 같습니다."; return;
        }
        result   = dijkstra(pathFromNodeId, pathToNodeId, edges, wheelchair);
        labelFrom = `#${pathFromNodeId} ${nodeMap[pathFromNodeId]?.name || ""}`;
        labelTo   = `#${pathToNodeId} ${nodeMap[pathToNodeId]?.name || ""}`;
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
        if (i === 0)                    li.className = "start";
        if (i === result.path.length-1) li.className = "end";
        listEl.appendChild(li);
    });

    // 지도 범위 조정
    const bounds = new kakao.maps.LatLngBounds();
    linePath.forEach(p => bounds.extend(p));
    map.setBounds(bounds, 40);

    applyPathDisplay();
}

function clearPathTest() {
    if (pathPolyline) { pathPolyline.setMap(null); pathPolyline = null; }
    pathNodeIds = [];
    document.getElementById("pathResult").textContent = "경로를 선택하세요.";
    document.getElementById("pathNodeList").innerHTML = "";
    updateNodeMarkers();
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
        if      (pathDisplay === "all")    show = activeNodeTypes.has(item.type);
        else if (pathDisplay === "path")   show = pathSet.has(item.data.id);
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
    const searchList  = document.getElementById("searchList");

    function runSearch() {
        const query = searchInput.value.trim().toLowerCase();
        searchList.innerHTML = "";
        if (!query) { searchList.style.display = "none"; return; }

        const results = allPoi.filter(p =>
            String(p.id).includes(query) || p.name.toLowerCase().includes(query));

        if (results.length === 0) {
            searchList.innerHTML = "<li style='padding:8px;color:#999;'>검색 결과 없음</li>";
            searchList.style.display = "block"; return;
        }

        results.forEach(p => {
            const li = document.createElement("li");
            li.innerHTML = `<span style="color:#999;font-size:11px;margin-right:4px;">#${p.id}</span>${p.name}`;
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