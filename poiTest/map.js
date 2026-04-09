/*api 가져오기*/
var container = document.getElementById('map');
var options = {
    center: new kakao.maps.LatLng(37.55843493, 127.04983095),
    level: 3
};

const imageSize = new kakao.maps.Size(32, 32);

/* 마커 이미지 설정*/
const markerImages = {
    entrance: new kakao.maps.MarkerImage(
        "images/blueMarker.png",
        imageSize
    ),
    ramp: new kakao.maps.MarkerImage(
        "images/greenMarker.png",
        imageSize
    ),
    stair: new kakao.maps.MarkerImage(
        "images/redMarker.png",
        imageSize
    ),
    elevator: new kakao.maps.MarkerImage(
        "images/orangeMarker.png",
        imageSize
    ),
    crosswalk: new kakao.maps.MarkerImage(
        "images/pinkMarker.png",
        imageSize
    )
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
var infowindow = new kakao.maps.InfoWindow({
    removable: false
});

/*json 파일 가져오기*/
fetch("poi.json")
    .then(res => res.json())
    .then(poi => {

        var markers = [];

        /*변수 초기화*/
        var entranceCount = 0;
        var rampCount = 0;
        var stairCount = 0;
        var elevatorCount = 0;
        var crosswalkCount = 0;
        /* 타입별 갯수*/
        poi.forEach(poi => {
            switch (poi.type) {
                case "entrance":
                    entranceCount++;
                    break;
                case "ramp":
                    rampCount++;
                    break;
                case "stair":
                    stairCount++;
                    break;
                case "elevator":
                    elevatorCount++;
                    break;
                case "crosswalk":
                    crosswalkCount++;
                    break;
            }
            var marker = new kakao.maps.Marker({
                map: map,
                position: new kakao.maps.LatLng(
                    poi.lat,
                    poi.lng
                ),
                image: markerImages[poi.type]
            });
            // ⭐ 마커 클릭 시 선 그리기
            kakao.maps.event.addListener(marker, "click", function () {

                var position = marker.getPosition();

                clickPath.push(position);

                polyline.setOptions({
                    path: clickPath,
                    strokeColor: "#FF4757"
                });

                polyline.setMap(map);

            });
            // 마우스 올리면 인포윈도우 열기
            kakao.maps.event.addListener(marker, "mouseover", function () {

                var content =
                    "<div style='padding:5px; font-size:12px;'>" +
                    "ID: " + poi.id + "<br>" +
                    poi.name +
                    "</div>";

                infowindow.setContent(content);
                infowindow.open(map, marker);

            });

            // 마우스 내리면 인포윈도우 닫기
            kakao.maps.event.addListener(marker, "mouseout", function () {
                infowindow.close();
            });

            markers.push({
                marker: marker,
                type: poi.type
            });
        });
        function updateMarkers() {

            var crosswalkChecked = document.getElementById("crosswalk").checked;
            var entranceChecked = document.getElementById("entranceCheck").checked;
            var rampChecked = document.getElementById("rampCheck").checked;
            var stairChecked = document.getElementById("stairCheck").checked;
            var elevatorChecked = document.getElementById("elevatorCheck").checked;

            var visibleCount = 0;

            markers.forEach(function (item) {

                var show = false;

                if (item.type === "crosswalk" && crosswalkChecked) show = true;
                if (item.type === "entrance" && entranceChecked) show = true;
                if (item.type === "ramp" && rampChecked) show = true;
                if (item.type === "stair" && stairChecked) show = true;
                if (item.type === "elevator" && elevatorChecked) show = true;

                if (show) {
                    item.marker.setMap(map);
                    visibleCount++;   // 보이는 마커만 카운트
                } else {
                    item.marker.setMap(null);
                }

            });
            function updateAllCheckState() {

                var allCheck = document.getElementById("allCheck");

                var entranceChecked = document.getElementById("entranceCheck").checked;
                var rampChecked = document.getElementById("rampCheck").checked;
                var stairChecked = document.getElementById("stairCheck").checked;
                var elevatorChecked = document.getElementById("elevatorCheck").checked;
                var crosswalkChecked = document.getElementById("crosswalk").checked;

                // 하나라도 false면 all 해제
                if (
                    entranceChecked &&
                    rampChecked &&
                    stairChecked &&
                    elevatorChecked &&
                    crosswalkChecked
                ) {
                    allCheck.checked = true;
                } else {
                    allCheck.checked = false;
                }

            }

            // 화면에 표시
            document.getElementById("visibleCount").innerText =
                visibleCount;

            updateAllCheckState();
        }
        document.getElementById("crosswalk")
            .addEventListener("change", updateMarkers);

        document.getElementById("entranceCheck")
            .addEventListener("change", updateMarkers);

        document.getElementById("rampCheck")
            .addEventListener("change", updateMarkers);

        document.getElementById("stairCheck")
            .addEventListener("change", updateMarkers);

        document.getElementById("elevatorCheck")
            .addEventListener("change", updateMarkers);

        document.getElementById("allCheck")
            .addEventListener("change", updateMarkers);

        document.getElementById("totalPoi").innerText = markers.length;
        document.getElementById("entranceCount").innerText = entranceCount;
        document.getElementById("rampCount").innerText = rampCount;
        document.getElementById("stairCount").innerText = stairCount;
        document.getElementById("elevatorCount").innerText = elevatorCount;
        document.getElementById("crosswalkCount").innerText = crosswalkCount;
        updateMarkers();

    });
/* 올체크 */
document.getElementById("allCheck").addEventListener("change", function () {

    var isChecked = this.checked;

    var checkboxes = document.querySelectorAll(".typeGrid input[type='checkbox']");

    checkboxes.forEach(function (checkbox) {

        if (checkbox.id !== "allCheck") {
            checkbox.checked = isChecked;
        }

    });

});

// ⭐ 지도 우클릭 시 선 초기화
kakao.maps.event.addListener(map, "rightclick", function () {

    clickPath = [];
    polyline.setMap(null);

});