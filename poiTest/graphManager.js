/* =============================================
   Node & Edge 통합 관리 페이지
   ============================================= */

// ===== 지도 초기화 =====
var container = document.getElementById('map');
var options = {
    center: new kakao.maps.LatLng(37.55843493, 127.04983095),
    level: 3
};

const imageSize = new kakao.maps.Size(32, 32);

const markerImages = {
    entrance: new kakao.maps.MarkerImage("images/blueMarker.png", imageSize),
    ramp: new kakao.maps.MarkerImage("images/greenMarker.png", imageSize),
    stair: new kakao.maps.MarkerImage("images/redMarker.png", imageSize),
    elevator: new kakao.maps.MarkerImage("images/orangeMarker.png", imageSize),
    crosswalk: new kakao.maps.MarkerImage("images/pinkMarker.png", imageSize),
    path: new kakao.maps.MarkerImage("images/greyMarker.png", imageSize),
    building: new kakao.maps.MarkerImage("images/yellowMarker.png", imageSize)
};

var map = new kakao.maps.Map(container, options);

// ===== 인포윈도우 =====
var infowindow = new kakao.maps.InfoWindow({ removable: false });
var searchInfowindow = new kakao.maps.InfoWindow({ removable: true });
var edgeInfowindow = new kakao.maps.InfoWindow({ removable: false });

// ===== 전역 상태 =====
let allPoi = [];
let markers = [];   // { marker, type, data }
let polylines = [];   // { polyline, edge }
let nodeMap = {};   // id → poi

let selectedNodeId = null;   // 현재 선택된 노드 ID
let edgesVisible = true;   // 전체 엣지 표시 여부
let nodeFilterActive = false;  // 노드 연결 필터 활성 여부
let activeEdgeTypes = new Set();

const EDGE_COLORS = {
    path: "#2563eb",
    ramp: "#16a34a",
    stair: "#ef4444",
    elevator: "#9333ea",
    crosswalk: "#f97316",
};

const NODE_COLORS = {
    entrance: "blue",
    ramp: "green",
    stair: "red",
    elevator: "orange",
    crosswalk: "hotpink",
    path: "darkgrey",
    building: "rgb(229, 229, 0)",
};

// ===== 데이터 로드 =====
Promise.all([
    fetch("poi.json").then(r => r.json()),
    fetch("edge.json").then(r => r.json()),
])
    .then(([poiData, edgeData]) => {
        allPoi = poiData;
        nodeMap = Object.fromEntries(poiData.map(p => [p.id, p]));

        initNodes(poiData);
        initEdges(edgeData);
        initEdgeTypeFilters(edgeData);

        document.getElementById("totalNode").innerText = poiData.length;
        document.getElementById("totalEdge").innerText = edgeData.length;
    })
    .catch(err => console.error("데이터 로드 실패:", err));


/* =============================================
   NODE
   ============================================= */

// 노드 타입별 활성 상태
let activeNodeTypes = new Set();

function initNodes(poi) {

    // 마커 생성
    poi.forEach(p => {
        var marker = new kakao.maps.Marker({
            map: map,
            position: new kakao.maps.LatLng(p.lat, p.lng),
            image: markerImages[p.type]
        });

        kakao.maps.event.addListener(marker, "mouseover", function () {
            infowindow.setContent(
                "<div style='padding:5px;font-size:12px;'>" +
                "ID: " + p.id + "<br>" + p.name + "</div>"
            );
            infowindow.open(map, marker);
        });
        kakao.maps.event.addListener(marker, "mouseout", function () {
            infowindow.close();
        });

        kakao.maps.event.addListener(marker, "click", function () {
            selectNode(p.id);
        });

        markers.push({ marker, type: p.type, data: p });
    });

    initNodeTypeFilters(poi);
    updateNodeMarkers();
    initSearch();
}

// 노드 타입 필터 UI 동적 생성 (edge 필터와 동일한 형식)
function initNodeTypeFilters(poi) {
    const typeCounts = {};
    poi.forEach(p => { typeCounts[p.type] = (typeCounts[p.type] || 0) + 1; });
    const types = Object.keys(typeCounts);
    types.forEach(t => activeNodeTypes.add(t));

    const container = document.getElementById("nodeTypeFilters");

    // all 체크박스
    const allLabel = document.createElement("label");
    allLabel.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;font-weight:bold;";
    allLabel.innerHTML = '<input type="checkbox" id="nodeAllCheck" checked> all';
    container.appendChild(allLabel);

    // 타입별 체크박스
    types.forEach(type => {
        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;";
        label.innerHTML = `
            <input type="checkbox" checked data-node-type="${type}">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;flex-shrink:0;background:${NODE_COLORS[type] || '#888'};"></span>
            ${type} (${typeCounts[type]})
        `;
        label.querySelector("input").addEventListener("change", function () {
            if (this.checked) activeNodeTypes.add(type);
            else activeNodeTypes.delete(type);
            // allCheck 동기화
            const allCbs = container.querySelectorAll("input[data-node-type]");
            document.getElementById("nodeAllCheck").checked = [...allCbs].every(cb => cb.checked);
            updateNodeMarkers();
        });
        container.appendChild(label);
    });

    // nodeAllCheck 이벤트
    document.getElementById("nodeAllCheck").addEventListener("change", function () {
        const checked = this.checked;
        container.querySelectorAll("input[data-node-type]").forEach(cb => {
            cb.checked = checked;
            if (checked) activeNodeTypes.add(cb.dataset.nodeType);
            else activeNodeTypes.delete(cb.dataset.nodeType);
        });
        updateNodeMarkers();
    });
}

// 노드 선택 → 연결 엣지 필터 + 컨트롤박스 목록 표시
function selectNode(id) {
    selectedNodeId = id;
    nodeFilterActive = true;
    edgesVisible = true;  // 숨김 상태여도 연결 엣지는 표시
    const p = nodeMap[id];
    if (!p) return;

    document.getElementById("selectedNodeInfo").innerText = `#${id} ${p.name}`;
    document.getElementById("nodeIdInput").value = id;

    // 연결된 엣지 목록 표시
    const connected = polylines.filter(({ edge }) =>
        edge.from === id || edge.to === id
    );
    const listEl = document.getElementById("connectedEdgeList");
    listEl.innerHTML = "";
    connected.forEach(({ edge }) => {
        const otherId = edge.from === id ? edge.to : edge.from;
        const other = nodeMap[otherId];
        const li = document.createElement("li");
        li.textContent = `#${edge.from}↔#${edge.to}  ${edge.type}  ${edge.weight}m`;
        li.title = other ? other.name : "";
        listEl.appendChild(li);
    });
    document.getElementById("connectedEdgeCount").innerText = connected.length;

    applyEdgeFilter();
}

// 선택 해제
function clearSelection() {
    selectedNodeId = null;
    nodeFilterActive = false;
    document.getElementById("selectedNodeInfo").innerText = "없음";
    document.getElementById("nodeIdInput").value = "";
    document.getElementById("connectedEdgeList").innerHTML = "";
    document.getElementById("connectedEdgeCount").innerText = 0;
    applyEdgeFilter();
}

// 컨트롤박스 ID 입력으로 노드 선택
function selectNodeById() {
    const id = Number(document.getElementById("nodeIdInput").value);
    if (!nodeMap[id]) { alert(`노드 #${id} 를 찾을 수 없습니다.`); return; }
    selectNode(id);
}

// 노드 전체 표시 / 숨기기
function toggleNodes(show) {
    markers.forEach(({ marker }) => marker.setMap(show ? map : null));
    if (show) updateNodeMarkers();
}

// 노드 타입 필터 적용
function updateNodeMarkers() {
    let visibleCount = 0;
    markers.forEach(item => {
        const show = activeNodeTypes.has(item.type);
        item.marker.setMap(show ? map : null);
        if (show) visibleCount++;
    });
    document.getElementById("visibleCount").innerText = visibleCount;
}


/* =============================================
   EDGE
   ============================================= */
function initEdges(edges) {
    edges.forEach(e => {
        const from = nodeMap[e.from];
        const to = nodeMap[e.to];
        if (!from || !to) return;

        const polyline = new kakao.maps.Polyline({
            map: map,
            path: [
                new kakao.maps.LatLng(from.lat, from.lng),
                new kakao.maps.LatLng(to.lat, to.lng),
            ],
            strokeWeight: 3,
            strokeColor: EDGE_COLORS[e.type] || "#888888",
            strokeOpacity: 0.85,
            strokeStyle: "solid",
        });

        kakao.maps.event.addListener(polyline, "mouseover", function (mouseEvent) {
            const fromName = nodeMap[e.from] ? nodeMap[e.from].name : e.from;
            const toName = nodeMap[e.to] ? nodeMap[e.to].name : e.to;
            edgeInfowindow.setContent(
                "<div style='padding:5px;font-size:12px;line-height:1.6'>" +
                `<b>#${e.from}</b> ${fromName}<br>` +
                `↕ <b>#${e.to}</b> ${toName}<br>` +
                `type: ${e.type} &nbsp; weight: ${e.weight}m` +
                "</div>"
            );
            edgeInfowindow.setPosition(mouseEvent.latLng);
            edgeInfowindow.open(map);
        });
        kakao.maps.event.addListener(polyline, "mouseout", function () {
            edgeInfowindow.close();
        });

        polylines.push({ polyline, edge: e });
    });

    applyEdgeFilter();
}

// 엣지 타입 필터 UI 생성 (all 체크박스 포함)
function initEdgeTypeFilters(edges) {
    const types = [...new Set(edges.map(e => e.type))];
    types.forEach(t => activeEdgeTypes.add(t));

    const container = document.getElementById("edgeTypeFilters");

    // all 체크박스
    const allLabel = document.createElement("label");
    allLabel.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;font-weight:bold;";
    allLabel.innerHTML = `<input type="checkbox" id="edgeAllCheck" checked> all`;
    container.appendChild(allLabel);

    // 타입별 체크박스
    types.forEach(type => {
        const count = edges.filter(e => e.type === type).length;
        const color = EDGE_COLORS[type] || "#888";

        const label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:12px;cursor:pointer;";
        label.innerHTML = `
            <input type="checkbox" checked data-edge-type="${type}">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            ${type} (${count})
        `;
        label.querySelector("input").addEventListener("change", function () {
            if (this.checked) activeEdgeTypes.add(type);
            else activeEdgeTypes.delete(type);
            // allCheck 상태 동기화
            const allCbs = container.querySelectorAll("input[data-edge-type]");
            document.getElementById("edgeAllCheck").checked = [...allCbs].every(cb => cb.checked);
            applyEdgeFilter();
        });
        container.appendChild(label);
    });

    // edgeAllCheck 이벤트
    document.getElementById("edgeAllCheck").addEventListener("change", function () {
        const checked = this.checked;
        container.querySelectorAll("input[data-edge-type]").forEach(cb => {
            cb.checked = checked;
            if (checked) activeEdgeTypes.add(cb.dataset.edgeType);
            else activeEdgeTypes.delete(cb.dataset.edgeType);
        });
        applyEdgeFilter();
    });
}

// 엣지 필터 적용 + 표시 카운트 업데이트
function applyEdgeFilter() {
    let visibleCount = 0;
    polylines.forEach(({ polyline, edge }) => {
        const typeOk = activeEdgeTypes.has(edge.type);
        const nodeOk = !nodeFilterActive
            || edge.from === selectedNodeId
            || edge.to === selectedNodeId;
        const show = edgesVisible && typeOk && nodeOk;
        polyline.setMap(show ? map : null);
        if (show) visibleCount++;
    });
    document.getElementById("visibleEdgeCount").innerText = visibleCount;
}

// 엣지 전체 표시 / 숨기기 → 노드 필터 해제 후 적용
function toggleEdges(show) {
    edgesVisible = show;
    if (nodeFilterActive) clearSelection(); // 노드 필터 해제
    else applyEdgeFilter();
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
            String(p.id).includes(query) ||
            p.name.toLowerCase().includes(query)
        );

        if (results.length === 0) {
            searchList.innerHTML = "<li style='padding:8px;color:#999;'>검색 결과 없음</li>";
            searchList.style.display = "block";
            return;
        }

        results.forEach(p => {
            const li = document.createElement("li");
            li.innerHTML = `<span style="color:#999;font-size:11px;margin-right:4px;">#${p.id}</span>${p.name}`;
            li.addEventListener("click", () => {
                searchInfowindow.close();
                const target = markers.find(m => m.data.id === p.id);
                if (target) {
                    searchInfowindow.setContent(
                        `<div style="padding:6px 10px;font-size:12px;"><b>#${p.id}</b> ${p.name}</div>`
                    );
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