// 📌 1. POI (지점) 노드 생성 예시
CREATE (:POI {
    poi_id: "p-001",
    poi_name: "정보문화관 정문",
    poi_type: "Entrance",
    // # point(): Neo4j에는 위도와 경도를 하나로 묶어 처리하는 특수 타입
    location: point({latitude: 37.5665, longitude: 126.9780}),  // 위경도 통합
    floor_info: "1F",
    description: "휠체어 전용 경사로가 있는 문입니다",
    photo_url: "https://campus-map.com/photo/p001.jpg",
    is_interior: false
});

CREATE (:POI {
    poi_id: "p-002",
    poi_name: "본관 앞 광장",
    poi_type: "Square",
    location: point({latitude: 37.5670, longitude: 126.9785}),
    floor_info: "1F",
    is_interior: false
});

// ==========================================
// 📌 2. LEADS_TO (경로 연결) 관계 생성 예시

MATCH (a:POI {poi_id: "p-001"}), (b:POI {poi_id: "p-002"})
CREATE (a)-[:LEADS_TO {     // [:LEADS_TO]: 지점 간 이동 경로
    distance: 25.5,
    slope_degree: +3.5,
    effort_level: 2,
    path_width: 2.0,
    is_active: true
}]->(b);

// ==========================================
// 📌 3. User (사용자) 노드 생성 예시

CREATE (:User {
    user_id: "u-me",
    user_type: "Requester" // Requester 또는 Volunteer
});

// ==========================================
// 📌 4. Facility (편의시설) 노드 및 위치 관계 예시

MATCH (p:POI {poi_id: "p-001"})
CREATE (:Facility {
    facility_id: "f-001",
    facility_name: "장애인 전용 화장실",
    category: "Restroom",
    open_hours: "09:00 - 21:00",
    tel_no: "02-1234-5678",
    facility_features: "자동문, 비상벨 설치"
})-[:LOCATED_AT]->(p);      //[:LOCATED_AT]: 시설의 위치

// ==========================================
// 📌 5. UserReport (제보) 노드 및 관계 예시
// 제보는 POI와 완전히 겹치지 않을 수 있으므로 자기만의 location을 가짐

MATCH (u:User {user_id: "u-me"}), (p:POI {poi_id: "p-001"})
CREATE (u)-[:CREATED_REPORT]->(r:UserReport {   //[:CREATED_REPORT]: 사용자의 제보 행위
    report_id: "r-999",
    category: "보도블록 파손",
    description: "휠체어 바퀴가 걸릴 위험이 있습니다",
    location: point({latitude: 37.5667, longitude: 126.9781}), // POI 근처의 실제 위치
    status: "PENDING",
    created_at: "2026-04-12"
})-[:NEAR_BY]->(p); //[:NEAR_BY]: 제보 지점과 가장 가까운 시설/POI 연결

// ==========================================
// 📌 6. EmergencyRequest (긴급 요청) 노드 및 관계 예시

MATCH (req:User {user_id: "u-me"}), (p:POI {poi_id: "p-002"})
CREATE (req)-[:REQUESTS_HELP]->(er:EmergencyRequest {   //[:REQUESTS_HELP]: 긴급 도움 요청
    request_id: "e-777",
    message: "휠체어 배터리가 방전되었습니다. 도움이 필요합니다.",
    location: point({latitude: 37.5671, longitude: 126.9786}), // 현재 사용자 위치
    match_status: "REQUESTING"
})-[:AT_LOCATION]->(p); //[:AT_LOCATION]: 긴급 상황 발생 지점