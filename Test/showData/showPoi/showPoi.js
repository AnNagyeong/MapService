/*api 가져오기*/
var container = document.getElementById('map');
var options = {
    center: new kakao.maps.LatLng(37.55843493, 127.04983095),
    level: 3
};

const imageSize = new kakao.maps.Size(32, 32);

/* 마커 이미지 설정*/
const markerImages = {
    entrance: new kakao.maps.MarkerImage("../../images/blueMarker.png", imageSize),
    ramp:     new kakao.maps.MarkerImage("../../images/greenMarker.png", imageSize),
    stair:    new kakao.maps.MarkerImage("../../images/redMarker.png", imageSize),
    elevator: new kakao.maps.MarkerImage("../../images/orangeMarker.png", imageSize),
    crosswalk:new kakao.maps.MarkerImage("../../images/pinkMarker.png", imageSize),
    path:     new kakao.maps.MarkerImage("../../images/greyMarker.png", imageSize),
    building: new kakao.maps.MarkerImage("../../images/yellowMarker.png", imageSize)
};

var map = new kakao.maps.Map(container, options);

// ===== 선 그리기용 변수 =====
let clickPath = [];
let polyline = new kakao.maps.Polyline({
    strokeWeight: 5,
    strokeOpacity: 0.8,
    strokeStyle: 'solid'
});

// 인포윈도우 하나만 생성 (재사용)
var infowindow = new kakao.maps.InfoWindow({ removable: false });

// ===== 검색용 전역 변수 =====
let allPoi = [];         // 전체 POI 데이터
let searchMarker = null; // 검색 결과 강조 마커

/*json 파일 가져오기*/
fetch("../../data/poi.json")
    .then(res => res.json())
    .then(poi => {

        allPoi = poi; // 검색에서 쓸 수 있도록 저장

        var markers = [];

        var entranceCount = 0, rampCount = 0, stairCount = 0,
            elevatorCount = 0, crosswalkCount = 0, pathCount = 0, buildingCount = 0;

        poi.forEach(poi => {
            switch (poi.type) {
                case "entrance":  entranceCount++;  break;
                case "ramp":      rampCount++;      break;
                case "stair":     stairCount++;     break;
                case "elevator":  elevatorCount++;  break;
                case "crosswalk": crosswalkCount++; break;
                case "path":      pathCount++;      break;
                case "building":  buildingCount++;  break;
            }

            var marker = new kakao.maps.Marker({
                map: map,
                position: new kakao.maps.LatLng(poi.lat, poi.lng),
                image: markerImages[poi.type]
            });

            kakao.maps.event.addListener(marker, "click", function () {
                var position = marker.getPosition();
                var lastPosition = clickPath[clickPath.length - 1];
                if (
                    lastPosition &&
                    lastPosition.getLat() === position.getLat() &&
                    lastPosition.getLng() === position.getLng()
                ) {
                    clickPath.pop();
                } else {
                    clickPath.push(position);
                }
                if (clickPath.length > 0) {
                    polyline.setOptions({ path: clickPath, strokeColor: "#FF4757" });
                    polyline.setMap(map);
                } else {
                    polyline.setMap(null);
                }
            });

            kakao.maps.event.addListener(marker, "mouseover", function () {
                infowindow.setContent(
                    "<div style='padding:5px; font-size:12px;'>" +
                    "ID: " + poi.id + "<br>" + poi.name + "</div>"
                );
                infowindow.open(map, marker);
            });

            kakao.maps.event.addListener(marker, "mouseout", function () {
                infowindow.close();
            });

            markers.push({ marker, type: poi.type, data: poi });
        });

        // ===== 검색 기능 =====
        const searchInput = document.getElementById("searchInput");
        const searchBtn   = document.getElementById("searchBtn");
        const searchList  = document.getElementById("searchList");

        // 검색 실행
        function runSearch() {
            const query = searchInput.value.trim().toLowerCase();
            searchList.innerHTML = "";

            // 검색어 없으면 목록 숨기기
            if (!query) {
                searchList.style.display = "none";
                clearSearchMarker();
                return;
            }

            // id(숫자) 또는 이름으로 필터링
            const results = allPoi.filter(p =>
                String(p.id).includes(query) ||
                p.name.toLowerCase().includes(query)
            );

            if (results.length === 0) {
                searchList.innerHTML = "<li style='padding:10px;color:#999;'>검색 결과 없음</li>";
                searchList.style.display = "block";
                clearSearchMarker();
                return;
            }

            // 결과 목록 렌더링
            results.forEach(p => {
                const li = document.createElement("li");
                li.style.cssText = "padding:8px 12px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px;";
                li.innerHTML = `<span style="color:#999;font-size:11px;margin-right:6px;">#${p.id}</span>${p.name}`;

                li.addEventListener("mouseenter", () => li.style.background = "#f5f8ff");
                li.addEventListener("mouseleave", () => li.style.background = "white");

                // 클릭 시 해당 위치로 이동 + 강조 마커
                li.addEventListener("click", () => {
                    moveToResult(p);
                    searchList.style.display = "none";
                    searchInput.value = p.name;
                });

                searchList.appendChild(li);
            });

            searchList.style.display = "block";
        }

        // 검색 결과 인포윈도우 표시
        // 별도 인포윈도우 생성 (mouseover 인포윈도우와 충돌 방지)
        var searchInfowindow = new kakao.maps.InfoWindow({ removable: true });

        function moveToResult(p) {
            clearSearchMarker();

            // 기존 마커 중 해당 POI와 같은 위치 마커 찾아서 인포윈도우 열기
            const target = markers.find(m => m.data.id === p.id);
            if (!target) return;

            searchInfowindow.setContent(
                "<div style='padding:6px 10px;font-size:13px;font-weight:600'>" +
                "#" + p.id + " " + p.name + "</div>"
            );
            searchInfowindow.open(map, target.marker);
        }

        function clearSearchMarker() {
            searchInfowindow.close();
        }

        // 이벤트 연결
        searchBtn.addEventListener("click", runSearch);

        searchInput.addEventListener("keydown", e => {
            if (e.key === "Enter") runSearch();
        });

        // 입력 중 실시간 검색
        searchInput.addEventListener("input", runSearch);

        // 검색창 밖 클릭 시 목록 닫기
        document.addEventListener("click", e => {
            if (!e.target.closest("#searchWrapper")) {
                searchList.style.display = "none";
            }
        });

        // ===== 마커 필터 =====
        function updateMarkers() {
            var crosswalkChecked = document.getElementById("crosswalk").checked;
            var entranceChecked  = document.getElementById("entranceCheck").checked;
            var rampChecked      = document.getElementById("rampCheck").checked;
            var stairChecked     = document.getElementById("stairCheck").checked;
            var elevatorChecked  = document.getElementById("elevatorCheck").checked;
            var pathChecked      = document.getElementById("pathCheck").checked;
            var buildingChecked  = document.getElementById("buildingCheck").checked;

            var visibleCount = 0;

            markers.forEach(function (item) {
                var show = false;
                if (item.type === "crosswalk" && crosswalkChecked) show = true;
                if (item.type === "entrance"  && entranceChecked)  show = true;
                if (item.type === "ramp"      && rampChecked)      show = true;
                if (item.type === "stair"     && stairChecked)     show = true;
                if (item.type === "elevator"  && elevatorChecked)  show = true;
                if (item.type === "path"      && pathChecked)      show = true;
                if (item.type === "building"  && buildingChecked)  show = true;

                if (show) { item.marker.setMap(map); visibleCount++; }
                else      { item.marker.setMap(null); }
            });

            function updateAllCheckState() {
                var allCheck = document.getElementById("allCheck");
                allCheck.checked = (
                    entranceChecked && rampChecked && stairChecked &&
                    elevatorChecked && crosswalkChecked && pathChecked && buildingChecked
                );
            }

            document.getElementById("visibleCount").innerText = visibleCount;
            updateAllCheckState();
        }

        document.getElementById("crosswalk")    .addEventListener("change", updateMarkers);
        document.getElementById("entranceCheck") .addEventListener("change", updateMarkers);
        document.getElementById("rampCheck")     .addEventListener("change", updateMarkers);
        document.getElementById("stairCheck")    .addEventListener("change", updateMarkers);
        document.getElementById("elevatorCheck") .addEventListener("change", updateMarkers);
        document.getElementById("pathCheck")     .addEventListener("change", updateMarkers);
        document.getElementById("buildingCheck") .addEventListener("change", updateMarkers);
        document.getElementById("allCheck")      .addEventListener("change", updateMarkers);

        document.getElementById("totalPoi").innerText     = markers.length;
        document.getElementById("entranceCount").innerText = entranceCount;
        document.getElementById("rampCount").innerText     = rampCount;
        document.getElementById("stairCount").innerText    = stairCount;
        document.getElementById("elevatorCount").innerText = elevatorCount;
        document.getElementById("crosswalkCount").innerText= crosswalkCount;
        document.getElementById("pathCount").innerText     = pathCount;
        document.getElementById("buildingCount").innerText = buildingCount;
        updateMarkers();
    });

/* 올체크 */
document.getElementById("allCheck").addEventListener("change", function () {
    var isChecked = this.checked;
    document.querySelectorAll(".typeGrid input[type='checkbox']").forEach(function (cb) {
        if (cb.id !== "allCheck") cb.checked = isChecked;
    });
});

// 지도 우클릭 시 선 초기화
kakao.maps.event.addListener(map, "rightclick", function () {
    clickPath = [];
    polyline.setMap(null);
});