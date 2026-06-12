const API = 'http://localhost:3000';

const POI_TYPES = ['entrance', 'ramp', 'stair', 'elevator', 'crosswalk', 'path', 'building'];
const EDGE_TYPES = ['path', 'ramp', 'stair', 'elevator', 'crosswalk'];

// 이름→ID 변환용 내부 상태
const selectedIds = {};  // { addEdgeFrom: 'uuid...', addEdgeTo: 'uuid...', ... }

function setupNameAutocomplete(inputId, listId, stateKey, onSelect) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        list.innerHTML = '';
        selectedIds[stateKey] = null;
        if (!q) { list.style.display = 'none'; return; }

        const results = allPoi
            .filter(p => p.name.toLowerCase().includes(q))
            .slice(0, 10);

        if (!results.length) { list.style.display = 'none'; return; }
        results.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name;
            li.addEventListener('click', () => {
                input.value = p.name;
                selectedIds[stateKey] = p.id;
                list.style.display = 'none';
                if (onSelect) onSelect(p.id);
            });
            list.appendChild(li);
        });
        list.style.display = 'block';
    });
}
/* ── 토스트 알림 ─────────────────────────────────────────── */
function showToast(msg, isError = false) {
    const toast = document.getElementById('adminToast');
    toast.textContent = msg;
    toast.className = 'admin-toast' + (isError ? ' error' : ' success');
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

/* ── 탭 전환 ─────────────────────────────────────────────── */
function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tab === tab)
    );
    document.querySelectorAll('.admin-tab-pane').forEach(pane =>
        pane.style.display = pane.dataset.pane === tab ? 'block' : 'none'
    );
}

/* =============================================
   POI 관리
   ============================================= */

/* ── 노드 추가 ───────────────────────────────────────────── */
async function adminAddPoi() {
    const name = document.getElementById('addPoiName').value.trim();
    const lat = parseFloat(document.getElementById('addPoiLat').value);
    const lng = parseFloat(document.getElementById('addPoiLng').value);
    const type = document.getElementById('addPoiType').value;

    if (!name || isNaN(lat) || isNaN(lng)) {
        showToast('이름, 위도, 경도를 모두 입력하세요.', true); return;
    }

    try {
        const res = await fetch(`${API}/api/poi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, lat, lng, type })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // 전역 상태에 반영
        const newPoi = {
            id: data.id, name: data.name, lat: data.lat, lng: data.lng,
            type: data.type, panorama_url: data.panorama_url, entrances: []
        };
        allPoi.push(newPoi);
        nodeMap[data.id] = newPoi;

        // 마커 추가
        const marker = new kakao.maps.Marker({
            map,
            position: new kakao.maps.LatLng(data.lat, data.lng),
            image: markerImages[data.type]
        });
        kakao.maps.event.addListener(marker, 'mouseover', () => {
            infowindow.setContent(`<div style="padding:5px;font-size:12px;">${data.name}</div>`);
            infowindow.open(map, marker);
        });
        kakao.maps.event.addListener(marker, 'mouseout', () => infowindow.close());
        kakao.maps.event.addListener(marker, 'click', () => selectNode(data.id));
        markers.push({ marker, type: data.type, data: newPoi });

        // 폼 초기화
        ['addPoiName', 'addPoiLat', 'addPoiLng'].forEach(id =>
            document.getElementById(id).value = '');

        document.getElementById('totalNode').innerText =
            allPoi.filter(p => p.type !== 'building').length;

        showToast(`✅ 노드 "${name}" 추가 완료 (ID: ${data.id})`);
    } catch (err) {
        showToast('추가 실패: ' + err.message, true);
    }
}

/* ── 지도 클릭으로 좌표 자동 입력 ───────────────────────── */
let mapClickMode = false;
let mapClickListener = null;

function toggleMapClickMode() {
    mapClickMode = !mapClickMode;
    const btn = document.getElementById('mapClickBtn');

    if (mapClickMode) {
        btn.textContent = '📌 클릭 중... (취소)';
        btn.classList.add('active');
        mapClickListener = kakao.maps.event.addListener(map, 'click', (mouseEvent) => {
            const latlng = mouseEvent.latLng;
            document.getElementById('addPoiLat').value = latlng.getLat().toFixed(7);
            document.getElementById('addPoiLng').value = latlng.getLng().toFixed(7);
            toggleMapClickMode(); // 한 번 클릭하면 모드 종료
        });
    } else {
        btn.textContent = '📌 지도 클릭으로 좌표 입력';
        btn.classList.remove('active');
        if (mapClickListener) {
            kakao.maps.event.removeListener(mapClickListener);
            mapClickListener = null;
        }
    }
}

/* ── 노드 수정 ───────────────────────────────────────────── */
async function adminUpdatePoi() {
    const id = document.getElementById('editPoiId').value.trim();
    const name = document.getElementById('editPoiName').value.trim();
    const lat = parseFloat(document.getElementById('editPoiLat').value);
    const lng = parseFloat(document.getElementById('editPoiLng').value);
    const type = document.getElementById('editPoiType').value;

    if (!id || !name || isNaN(lat) || isNaN(lng)) {
        showToast('ID, 이름, 위도, 경도를 모두 입력하세요.', true); return;
    }

    try {
        const res = await fetch(`${API}/api/poi/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, lat, lng, type })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // 전역 상태 갱신
        const poi = nodeMap[id];
        if (poi) {
            poi.name = name; poi.lat = lat; poi.lng = lng; poi.type = type;
        }
        // 마커 위치 갱신
        const markerItem = markers.find(m => m.data.id === id);
        if (markerItem) {
            markerItem.marker.setPosition(new kakao.maps.LatLng(lat, lng));
            markerItem.marker.setImage(markerImages[type] || null);
            markerItem.type = type;
        }

        showToast(`✅ 노드 "${name}" 수정 완료`);
    } catch (err) {
        showToast('수정 실패: ' + err.message, true);
    }
}

/* ── 수정 폼 자동 채우기 ─────────────────────────────────── */
function fillEditForm() {
    const id = document.getElementById('editPoiId').value.trim();
    const poi = nodeMap[id];
    if (!poi) { showToast('해당 ID의 노드를 찾을 수 없습니다.', true); return; }
    document.getElementById('editPoiName').value = poi.name;
    document.getElementById('editPoiLat').value = poi.lat;
    document.getElementById('editPoiLng').value = poi.lng;
    document.getElementById('editPoiType').value = poi.type;
    showToast(`"${poi.name}" 정보를 불러왔습니다.`);
}

/* ── 노드 삭제 ───────────────────────────────────────────── */
async function adminDeletePoi() {
    const id = document.getElementById('deletePoiId').value.trim();
    if (!id) { showToast('삭제할 노드를 선택하세요.', true); return; }

    const poi = nodeMap[id];
    const label = poi ? `"${poi.name}"` : '이 노드';
    if (!confirm(`노드 ${label} 및 연결된 모든 엣지를 삭제합니다. 계속하시겠습니까?`)) return;

    try {
        const res = await fetch(`${API}/api/poi/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const idx = markers.findIndex(m => m.data.id === id);
        if (idx !== -1) { markers[idx].marker.setMap(null); markers.splice(idx, 1); }

        polylines = polylines.filter(({ polyline, edge: e }) => {
            if (e.from === id || e.to === id) { polyline.setMap(null); return false; }
            return true;
        });

        allPoi = allPoi.filter(p => p.id !== id);
        delete nodeMap[id];

        document.getElementById('deletePoiId').value = '';
        document.getElementById('totalNode').innerText =
            allPoi.filter(p => p.type !== 'building').length;
        document.getElementById('totalEdge').innerText = polylines.length;

        showToast(`✅ 노드 ${label} 삭제 완료`);
    } catch (err) {
        showToast('삭제 실패: ' + err.message, true);
    }
}


/* ── 파노라마 사진 업로드 ────────────────────────────────── */
async function adminUploadPhoto() {
    const id = document.getElementById('photoPoiId').value.trim();
    const file = document.getElementById('photoFile').files[0];

    if (!id) { showToast('노드를 선택하세요.', true); return; }
    if (!file) { showToast('사진 파일을 선택하세요.', true); return; }

    const progressWrap = document.getElementById('uploadProgressWrap');
    const progressBar = document.getElementById('uploadProgress');
    progressWrap.style.display = 'block';
    progressBar.style.width = '0%';

    const formData = new FormData();
    formData.append('photo', file);

    try {
        const result = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API}/api/poi/${encodeURIComponent(id)}/photo`);
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable)
                    progressBar.style.width = Math.round(e.loaded / e.total * 100) + '%';
            };
            xhr.onload = () => {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                    else reject(new Error(data.error || `HTTP ${xhr.status}`));
                } catch (e) {
                    reject(new Error(`서버 응답 오류 (${xhr.status})`));
                }
            };
            xhr.onerror = () => reject(new Error('네트워크 오류'));
            xhr.ontimeout = () => reject(new Error('업로드 시간 초과'));
            xhr.timeout = 60000;
            xhr.send(formData);
        });

        if (nodeMap[id]) nodeMap[id].panorama_url = result.photo_url;

        document.getElementById('photoFile').value = '';
        document.getElementById('photoPreview').style.display = 'none';
        progressWrap.style.display = 'none';
        showToast(`✅ "${nodeMap[id]?.name}" 사진 업로드 완료`);
    } catch (err) {
        progressWrap.style.display = 'none';
        showToast('업로드 실패: ' + err.message, true);
    }
}


/* ── 파노라마 사진 삭제 ──────────────────────────────────── */
async function adminDeletePhoto() {
    const id = document.getElementById('photoPoiId').value.trim();
    if (!id) { showToast('노드를 선택하세요.', true); return; }
    if (!confirm(`"${nodeMap[id]?.name}"의 파노라마 사진을 삭제합니다.`)) return;

    try {
        const res = await fetch(`${API}/api/poi/${encodeURIComponent(id)}/photo`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (nodeMap[id]) nodeMap[id].panorama_url = null;
        showToast(`✅ "${nodeMap[id]?.name}" 사진 삭제 완료`);
    } catch (err) {
        showToast('삭제 실패: ' + err.message, true);
    }
}

/* ── 사진 미리보기 ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('photoFile');
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            const preview = document.getElementById('photoPreview');
            if (file && file.type.startsWith('image/')) {
                preview.src = URL.createObjectURL(file);
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
            }
        });
    }

    setupAdminAutocomplete('photoPoiId', 'photoPoidList');
    setupAdminAutocomplete('editPoiId', 'editPoiIdList');
    setupAdminAutocomplete('deletePoiId', 'deletePoiIdList');
    setupNameAutocomplete('addEdgeFrom', 'addEdgeFromList', 'addEdgeFrom');
    setupNameAutocomplete('addEdgeTo', 'addEdgeToList', 'addEdgeTo');
    setupNameAutocomplete('deleteEdgeFrom', 'deleteEdgeFromList', 'deleteEdgeFrom');
    setupNameAutocomplete('deleteEdgeTo', 'deleteEdgeToList', 'deleteEdgeTo');
    setupNameAutocomplete('entranceBuildingId', 'entranceBuildingList', 'entranceBuildingId',
        (id) => refreshEntranceList(id));
    setupNameAutocomplete('entranceNodeId', 'entranceNodeList', 'entranceNodeId');
});

function setupAdminAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        list.innerHTML = '';
        if (!q) { list.style.display = 'none'; return; }
        const results = allPoi.filter(p =>
            String(p.id).toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
        ).slice(0, 10);

        if (!results.length) { list.style.display = 'none'; return; }
        results.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span style="color:#999">#${p.id.slice(0, 8)}…</span> ${p.name}`;
            li.addEventListener('click', () => {
                input.value = p.id;
                list.style.display = 'none';
                // editPoiId면 자동 채우기
                if (inputId === 'editPoiId') fillEditForm();
            });
            list.appendChild(li);
        });
        list.style.display = 'block';
    });

    document.addEventListener('click', e => {
        if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${listId}`))
            list.style.display = 'none';
    });
}

/* =============================================
   Edge 관리
   ============================================= */

async function adminAddEdge() {
    const from = selectedIds['addEdgeFrom'];
    const to = selectedIds['addEdgeTo'];
    const weight = parseFloat(document.getElementById('addEdgeWeight').value);
    const type = document.getElementById('addEdgeType').value;

    if (!from) { showToast('출발 노드를 목록에서 선택하세요.', true); return; }
    if (!to) { showToast('도착 노드를 목록에서 선택하세요.', true); return; }
    if (isNaN(weight)) { showToast('거리를 입력하세요.', true); return; }

    try {
        const res = await fetch(`${API}/api/edge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, weight, type })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const edge = { from, to, weight, type };
        const pl = createPolyline(edge);
        if (pl) polylines.push({ polyline: pl, edge });

        document.getElementById('addEdgeFrom').value = '';
        document.getElementById('addEdgeTo').value = '';
        document.getElementById('addEdgeWeight').value = '';
        selectedIds['addEdgeFrom'] = null;
        selectedIds['addEdgeTo'] = null;
        document.getElementById('totalEdge').innerText = polylines.length;

        showToast(`✅ "${nodeMap[from]?.name}" ↔ "${nodeMap[to]?.name}" 엣지 추가 완료`);
    } catch (err) {
        showToast('추가 실패: ' + err.message, true);
    }
}

/* ── 거리 자동 계산 ──────────────────────────────────────── */
function calcEdgeDistance() {
    const from = selectedIds['addEdgeFrom'];
    const to = selectedIds['addEdgeTo'];
    if (!from || !to) { showToast('두 노드를 먼저 선택하세요.', true); return; }
    const f = nodeMap[from], t = nodeMap[to];
    const dist = haversine(f.lat, f.lng, t.lat, t.lng);
    document.getElementById('addEdgeWeight').value = dist;
    showToast(`📏 계산된 거리: ${dist}m`);
}

async function adminDeleteEdge() {
    const from = selectedIds['deleteEdgeFrom'];
    const to = selectedIds['deleteEdgeTo'];

    if (!from) { showToast('출발 노드를 목록에서 선택하세요.', true); return; }
    if (!to) { showToast('도착 노드를 목록에서 선택하세요.', true); return; }

    const fromName = nodeMap[from]?.name;
    const toName = nodeMap[to]?.name;
    if (!confirm(`"${fromName}" ↔ "${toName}" 엣지를 삭제합니다.`)) return;

    try {
        const res = await fetch(`${API}/api/edge`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const idx = polylines.findIndex(({ edge: e }) =>
            (e.from === from && e.to === to) || (e.from === to && e.to === from)
        );
        if (idx !== -1) { polylines[idx].polyline.setMap(null); polylines.splice(idx, 1); }

        document.getElementById('deleteEdgeFrom').value = '';
        document.getElementById('deleteEdgeTo').value = '';
        selectedIds['deleteEdgeFrom'] = null;
        selectedIds['deleteEdgeTo'] = null;
        document.getElementById('totalEdge').innerText = polylines.length;

        showToast(`✅ "${fromName}" ↔ "${toName}" 엣지 삭제 완료`);
    } catch (err) {
        showToast('삭제 실패: ' + err.message, true);
    }
}
/* =============================================
   building_entrance 관리
   ============================================= */

async function adminAddEntrance() {
    const building_id = selectedIds['entranceBuildingId'];
    const entrance_id = selectedIds['entranceNodeId'];

    if (!building_id) { showToast('건물을 목록에서 선택하세요.', true); return; }
    if (!entrance_id) { showToast('입구 노드를 목록에서 선택하세요.', true); return; }

    const b = nodeMap[building_id];
    const e = nodeMap[entrance_id];
    if (!b || b.type !== 'building') { showToast('유효한 건물이 아닙니다.', true); return; }
    if (!e) { showToast('입구 노드를 찾을 수 없습니다.', true); return; }

    try {
        const res = await fetch(`${API}/api/building-entrance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ building_id, entrance_id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (!b.entrances.includes(entrance_id)) b.entrances.push(entrance_id);
        refreshEntranceList(building_id);
        showToast(`✅ "${b.name}" ↔ "${e.name}" 입구 관계 추가 완료`);
    } catch (err) {
        showToast('추가 실패: ' + err.message, true);
    }
}


async function adminDeleteEntrance() {
    const building_id = selectedIds['entranceBuildingId'];
    const entrance_id = selectedIds['entranceNodeId'];

    if (!building_id) { showToast('건물을 목록에서 선택하세요.', true); return; }
    if (!entrance_id) { showToast('입구 노드를 목록에서 선택하세요.', true); return; }

    const b = nodeMap[building_id];
    const e = nodeMap[entrance_id];
    if (!confirm(`"${b?.name}" ↔ "${e?.name}" 입구 관계를 삭제합니다.`)) return;

    try {
        const res = await fetch(`${API}/api/building-entrance`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ building_id, entrance_id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        if (b) b.entrances = b.entrances.filter(id => id !== entrance_id);
        refreshEntranceList(building_id);

        document.getElementById('entranceBuildingId').value = '';
        document.getElementById('entranceNodeId').value = '';
        selectedIds['entranceBuildingId'] = null;
        selectedIds['entranceNodeId'] = null;

        showToast(`✅ "${b?.name}" ↔ "${e?.name}" 입구 관계 삭제 완료`);
    } catch (err) {
        showToast('삭제 실패: ' + err.message, true);
    }
}

function refreshEntranceList(buildingId) {
    const b = nodeMap[buildingId];
    const el = document.getElementById('entranceCurrentList');
    if (!b || !el) return;
    el.innerHTML = '';
    if (!b.entrances || b.entrances.length === 0) {
        el.innerHTML = '<li style="color:#999">등록된 입구 없음</li>'; return;
    }
    b.entrances.forEach(eid => {
        const n = nodeMap[eid];
        const li = document.createElement('li');
        li.innerHTML = `${n ? n.name : '(알 수 없음)'}
            <button onclick="quickDeleteEntrance('${buildingId}','${eid}')"
                    style="margin-left:6px;background:#ef4444;color:#fff;border:none;
                           border-radius:4px;padding:1px 6px;cursor:pointer;font-size:11px;">
                삭제
            </button>`;
        el.appendChild(li);
    });
}

function loadEntranceList() {
    const id = selectedIds['entranceBuildingId'];
    if (id) refreshEntranceList(id);
}

async function quickDeleteEntrance(building_id, entrance_id) {
    if (!confirm(`입구 관계를 삭제합니다.`)) return;
    document.getElementById('entranceBuildingId').value = building_id;
    document.getElementById('entranceNodeId').value = entrance_id;
    await adminDeleteEntrance();
}

/* ── 관리자 패널 열기/닫기 ───────────────────────────────── */
let adminPanelOpen = false;

function toggleAdminPanel() {
    adminPanelOpen = !adminPanelOpen;
    const panel = document.getElementById('adminPanel');
    panel.style.display = adminPanelOpen ? 'flex' : 'none';
    if (adminPanelOpen) switchAdminTab('poi');
}