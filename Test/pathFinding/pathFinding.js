let NODES = [];
let EDGES = [];
let BUILDINGS = [];
let nodeMap = {};

let kakaoMap = null;
let currentPolyline = null;

//데이터 로드
Promise.all([
  fetch("../data/poi.json").then(r => r.json()),
  fetch("../data/edge.json").then(r => r.json()),
])
  .then(([poiData, edgeData]) => {
    EDGES = edgeData;
    NODES = poiData.filter(p => p.type !== "building");
    BUILDINGS = poiData.filter(p => p.type === "building");
    nodeMap = Object.fromEntries(NODES.map(n => [n.id, n]));

    console.log("데이터 로드 완료 | nodes:", NODES.length, "edges:", EDGES.length, "buildings:", BUILDINGS.length);
    initMap();
  })
  .catch(err => {
    console.error("데이터 로드 실패:", err);
  });

//dijkstra
function dijkstra(startId, endId, edges, wheelchair = false) {
  const filtered = wheelchair
    ? edges.filter(e => e.type !== "stair")
    : edges;

  const graph = {};
  for (const e of filtered) {
    if (!graph[e.from]) graph[e.from] = [];
    if (!graph[e.to]) graph[e.to] = [];
    graph[e.from].push({ node: e.to, weight: e.weight });
    graph[e.to].push({ node: e.from, weight: e.weight });
  }

  const dist = {}, prev = {}, visited = new Set();
  for (const n of Object.keys(graph)) dist[n] = Infinity;
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
        dist[v] = nd;
        prev[v] = u;
        queue.push([nd, v]);
      }
    }
  }

  if (!isFinite(dist[endId])) return null;

  const path = [];
  let cur = endId;
  while (cur !== undefined) { path.unshift(Number(cur)); cur = prev[cur]; }
  return { path, distance: Math.round(dist[endId]) };
}

function findPath(fromBuilding, toBuilding, edges, wheelchair = false) {
  let best = null;
  for (const s of fromBuilding.entrances) {
    for (const e of toBuilding.entrances) {
      const r = dijkstra(s, e, edges, wheelchair);
      if (r && (!best || r.distance < best.distance)) {
        best = { ...r, fromEntrance: s, toEntrance: e };
      }
    }
  }
  return best;
}


//카카오맵 초기화
function initMap() {
  // 셀렉트 박스 채우기
  const selFrom = document.getElementById("sel-from");
  const selTo = document.getElementById("sel-to");
  BUILDINGS.forEach(b => {
    selFrom.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    selTo.innerHTML += `<option value="${b.id}">${b.name}</option>`;
  });
  selTo.selectedIndex = 1;

  // 지도 생성
  const container = document.getElementById("kakao-map");
  kakaoMap = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.55835032, 127.04985701),
    level: 2,
  });

  // 건물 마커
  BUILDINGS.forEach(b => {
    const marker = new kakao.maps.Marker({
      map: kakaoMap,
      position: new kakao.maps.LatLng(b.lat, b.lng),
      title: b.name,
    });
    const infowindow = new kakao.maps.InfoWindow({
      content: `<div style="padding:6px 10px;font-size:13px;font-weight:600">${b.name}</div>`
    });
    kakao.maps.event.addListener(marker, "click", () => {
      infowindow.open(kakaoMap, marker);
    });
  });

  // 버튼 이벤트
  document.getElementById("btn-find").addEventListener("click", handleFind);
}

//  경로 찾기
function handleFind() {
  const fromId = Number(document.getElementById("sel-from").value);
  const toId = Number(document.getElementById("sel-to").value);
  const wheelchair = document.getElementById("wheelchair").checked;

  if (fromId === toId) {
    showError("출발지와 도착지가 같습니다.");
    return;
  }

  const fromB = BUILDINGS.find(b => b.id === fromId);
  const toB = BUILDINGS.find(b => b.id === toId);
  const result = findPath(fromB, toB, EDGES, wheelchair);

  if (!result) {
    showError(wheelchair
      ? "휠체어 접근 가능한 경로가 없습니다.\n일반 모드로 다시 시도해보세요."
      : "경로를 찾을 수 없습니다."
    );
    return;
  }

  showResult(result, fromB, toB, wheelchair);
  drawPolyline(result.path, wheelchair);
}

//UI 업데이트
function showResult(result, fromB, toB, wheelchair) {
  const el = document.getElementById("result");
  el.className = "show";

  document.getElementById("result-title").textContent =
    wheelchair ? "휠체어 최단 경로" : "최단 경로";
  document.getElementById("result-distance").innerHTML =
    `${result.distance}<span>m</span>`;
  document.getElementById("result-path").textContent =
    `${fromB.name} → ${toB.name}`;

  const badgeMap = {
    stair: '<span class="badge badge-stair">계단</span>',
    ramp: '<span class="badge badge-ramp">경사로</span>',
    elevator: '<span class="badge badge-elevator">엘리베이터</span>',
    crosswalk: '<span class="badge badge-crosswalk">횡단보도</span>',
  };

  const stepsEl = document.getElementById("steps");
  stepsEl.innerHTML = "";
  result.path.forEach((id, i) => {
    const node = nodeMap[id];
    if (!node) return;

    const isStart = i === 0;
    const isEnd = i === result.path.length - 1;
    const dotClass = isStart ? "start" : isEnd ? "end" : "";
    const dotLabel = isStart ? "출" : isEnd ? "도" : i;
    const badge = badgeMap[node.type] || "";

    const div = document.createElement("div");
    div.className = "step";
    div.style.animationDelay = `${i * 40}ms`;
    div.innerHTML = `
      <div class="step-dot ${dotClass}">${dotLabel}</div>
      <div class="step-info">
        <div class="step-name">${node.name}${badge}</div>
      </div>
    `;
    stepsEl.appendChild(div);
  });
}

function showError(msg) {
  const el = document.getElementById("result");
  el.className = "show error";
  document.getElementById("result-title").textContent = "경로 없음";
  document.getElementById("result-distance").innerHTML = "—";
  document.getElementById("result-path").textContent = msg;
  document.getElementById("steps").innerHTML = "";
  if (currentPolyline) { currentPolyline.setMap(null); currentPolyline = null; }
}

function drawPolyline(path, wheelchair) {
  if (currentPolyline) currentPolyline.setMap(null);

  const linePath = path
    .map(id => nodeMap[id])
    .filter(Boolean)
    .map(n => new kakao.maps.LatLng(n.lat, n.lng));

  currentPolyline = new kakao.maps.Polyline({
    path: linePath,
    strokeWeight: 5,
    strokeColor: wheelchair ? "#f97316" : "#2563eb",
    strokeOpacity: 0.9,
    strokeStyle: "solid",
  });

  currentPolyline.setMap(kakaoMap);

  const bounds = new kakao.maps.LatLngBounds();
  linePath.forEach(p => bounds.extend(p));
  kakaoMap.setBounds(bounds, 60);
}