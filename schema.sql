-- 1. POI (지점 정보)
CREATE TABLE poi (
    poi_id VARCHAR(36) PRIMARY KEY, -- UUID
    poi_name VARCHAR(100) NOT NULL,
    poi_type VARCHAR(50),               -- 입구, 경사로, 엘리베이터 등
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    floor_info VARCHAR(10),
    description TEXT,
    photo_url VARCHAR(255),
    is_interior BOOLEAN DEFAULT FALSE
);

-- 2. PATH_CONNECTION (경로 연결 - 유향 그래프)
CREATE TABLE path_connection (
    start_poi_id VARCHAR(36),
    end_poi_id VARCHAR(36),
    distance FLOAT,                 -- 미터(m) 단위
    slope_degree FLOAT,             -- 오르막(+), 내리막(-)
    effort_level INT CHECK (effort_level BETWEEN 1 AND 5),
    path_width FLOAT,               -- 휠체어 통과 가능 너비
    is_active BOOLEAN DEFAULT TRUE, -- 실시간 통행 가능 여부
    PRIMARY KEY (start_poi_id, end_poi_id),
    FOREIGN KEY (start_poi_id) REFERENCES poi(poi_id),
    FOREIGN KEY (end_poi_id) REFERENCES poi(poi_id)
);

-- 3. USER (사용자 - 다이어그램 기반 추가)
CREATE TABLE user (
    user_id VARCHAR(50) PRIMARY KEY,
    user_type ENUM('Requester', 'Volunteer') NOT NULL
);

-- 4. FACILITY (편의시설 - 다이어그램 속성 반영)
CREATE TABLE facility (
    facility_id VARCHAR(36) PRIMARY KEY,
    facility_name VARCHAR(100),             -- 편의 시설 이름(사용자에게 보여짐)
    facility_category VARCHAR(50),           -- 장애인 화장실 등
    open_hours VARCHAR(100),
    tel_no VARCHAR(20),
    facility_features TEXT,                  -- Stairs, Ramp 정보 등 (JSON 권장)
    poi_id VARCHAR(36),
    FOREIGN KEY (poi_id) REFERENCES poi(poi_id)
);

-- 5. USER_REPORT (사용자 제보)
CREATE TABLE user_report (
    report_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(50),   
    -- 사용자 제보 위치          
    poi_id VARCHAR(36),                 -- 특정 POI 위라면 참조하고, 아니면 NULL 허용
    latitude DECIMAL(10, 8) NOT NULL,   -- 실제 제보 위치의 GPS를 직접 저장 (필수, POI 근처가 아닌 곳에서도 정확한 위치 전달하지 위함)
    longitude DECIMAL(11, 8) NOT NULL,  -- 실제 제보 위치의 GPS를 직접 저장 (필수, POI 근처가 아닌 곳에서도 정확한 위치 전달하지 위함)
    category VARCHAR(50),           -- 불법주차, 단차, 공사 등
    description TEXT,
    photo_url VARCHAR(255),
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(user_id)
);

-- 6. EMERGENCY_MATCH (긴급 매칭)
CREATE TABLE emergency_match (
    request_id VARCHAR(36) PRIMARY KEY,
    requester_id VARCHAR(50),
    volunteer_id VARCHAR(50),
    -- 도움 요청자의 위치
    latitude DECIMAL(10, 8) NOT NULL,   -- 사고 지점 GPS 직접 저장
    longitude DECIMAL(11, 8) NOT NULL,  -- 사고 지점 GPS 직접 저장
    poi_id VARCHAR(36) NULL,            -- 인근 POI가 있다면 참조
    message TEXT,
    match_status VARCHAR(20) DEFAULT 'REQUESTING',
    FOREIGN KEY (requester_id) REFERENCES user(user_id),
    FOREIGN KEY (volunteer_id) REFERENCES user(user_id)
);