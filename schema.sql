-- 📌 1. POI (지점 정보)
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

-- 📌 2. PATH_CONNECTION (경로 연결 - 유향 그래프)
CREATE TABLE path_connection (
    start_poi_id VARCHAR(36),
    end_poi_id VARCHAR(36),
    distance FLOAT,                 -- 미터(m) 단위
    slope_degree FLOAT,             -- 오르막(+), 내리막(-)
    effort_level INT CHECK (effort_level BETWEEN 1 AND 5),
    path_width FLOAT,               -- 휠체어 통과 가능 너비
    is_active BOOLEAN DEFAULT TRUE, -- 실시간 통행 가능 여부
    photo_url VARCHAR(255),         -- 경로 사진 (선택적)
    PRIMARY KEY (start_poi_id, end_poi_id),
    FOREIGN KEY (start_poi_id) REFERENCES poi(poi_id),
    FOREIGN KEY (end_poi_id) REFERENCES poi(poi_id)
);

-- 📌 3. USER (사용자 - 다이어그램 기반 추가)
CREATE TABLE user (
    user_id VARCHAR(50) PRIMARY KEY,
    user_type ENUM('Requester', 'Volunteer') NOT NULL
);

-- 📌 4. FACILITY (편의시설 - 다이어그램 속성 반영)
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

-- 📌 5-1. USER_REPORT (사용자 제보)
CREATE TABLE user_report (
    report_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(50),   
    -- 사용자 제보 위치          
    poi_id VARCHAR(36),                 -- 특정 POI 위라면 참조하고, 아니면 NULL 허용
    place_name VARCHAR(100),            -- 외부 장소 API에서 선택한 장소명
    place_address VARCHAR(255),         -- 외부 장소 API에서 선택한 주소
    latitude DECIMAL(10, 8) NOT NULL,   -- 실제 제보 위치의 GPS를 직접 저장 (필수, POI 근처가 아닌 곳에서도 정확한 위치 전달하지 위함)
    longitude DECIMAL(11, 8) NOT NULL,  -- 실제 제보 위치의 GPS를 직접 저장 (필수, POI 근처가 아닌 곳에서도 정확한 위치 전달하지 위함)
    category VARCHAR(50),           -- 불법주차, 단차, 공사 등
    wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') DEFAULT 'UNKNOWN',
    description TEXT,
    photo_url VARCHAR(255),
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES user(user_id)
);

-- 📌 5-2. PLACE_ACCESSIBILITY (관리자 승인 후 장소별 휠체어 진입 정보)
CREATE TABLE place_accessibility (
    place_accessibility_id VARCHAR(36) PRIMARY KEY,
    poi_id VARCHAR(36) NULL,
    place_name VARCHAR(100) NOT NULL,
    place_address VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') DEFAULT 'UNKNOWN',
    source_report_id VARCHAR(36),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (poi_id) REFERENCES poi(poi_id),
    FOREIGN KEY (source_report_id) REFERENCES user_report(report_id)
);

-- 📌 6. EMERGENCY_MATCH (긴급 매칭)
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

-- 📌 7-1. USERS (사용자 기본 정보)
CREATE TABLE users (
    user_id VARCHAR(36) PRIMARY KEY, -- UUID
    email VARCHAR(255) UNIQUE NULL,  -- 소셜 로그인 시 이메일이 없을 수도 있으므로 NULL 허용
    password_hash VARCHAR(255) NULL, -- 구글 로그인은 비밀번호가 없으므로 NULL 허용
    nickname VARCHAR(100),
    user_type ENUM('REQUESTER', 'VOLUNTEER', 'ADMIN') DEFAULT 'REQUESTER',
    profile_image_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL
);

-- 📌 7-2. USER_AUTH_PROVIDERS (소셜 로그인 인증 정보)
CREATE TABLE user_auth_providers (
    auth_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    provider VARCHAR(20) NOT NULL,           -- 'google', 'kakao', 'local' 등
    provider_user_id VARCHAR(255) NOT NULL,  -- 구글에서 넘겨주는 고유 식별자(sub)
    provider_email VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_provider_user (provider, provider_user_id), -- 동일한 소셜 계정 중복 가입 방지
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 📌 8-1. BOOKMARK_GROUP (즐겨찾기 그룹 폴더)
CREATE TABLE bookmark_group (
    group_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    group_name VARCHAR(100) NOT NULL, -- 예: '자주 가는 곳', '위험한 길'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 📌 8-2. BOOKMARK_ITEM (실제 즐겨찾기 장소)
CREATE TABLE bookmark_item (
    item_id VARCHAR(36) PRIMARY KEY,
    group_id VARCHAR(36) NOT NULL,
    poi_id VARCHAR(36) NULL,                 -- 교내 POI인 경우 참조
    place_name VARCHAR(100) NOT NULL,        -- 외부 장소일 경우를 대비해 장소명 필수
    place_address VARCHAR(255),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES bookmark_group(group_id) ON DELETE CASCADE,
    FOREIGN KEY (poi_id) REFERENCES poi(poi_id) ON DELETE SET NULL
);

-- 📌 기존 user_report 테이블 수정 제안
ALTER TABLE user_report 
MODIFY COLUMN status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING';