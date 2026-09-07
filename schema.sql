/* ============================================================
   Go-Lego Barrier-Free Navigation Service

   설계 핵심:
   1. MySQL은 사용자, 인증, POI 마스터, 접근성 제보, 사진 메타데이터, 감사 로그를 관리한다.
   2. Neo4j는 경로 탐색용 그래프 DB로 사용하며, MySQL의 path_connection을 동기화 원천으로 둔다.
   3. 경로 탐색 성능을 위해 poi_core와 path_connection은 가볍게 유지한다.
   4. 사진 데이터는 사용자 제보 사진(report_photo)과 자체 수집 길 안내 사진(navigation_photo)을 분리한다.
   5. 사용자의 이동 유형은 users에 저장하지 않고, 길찾기 API 호출 시 필터 파라미터로 처리한다.
   6. 출입구 필터링은 building_entrance의 속성과 복합 인덱스로 빠르게 처리한다.
   7. 접근성 현재 상태와 변경 이력은 place_accessibility와 accessibility_audit_log로 분리한다.
   ============================================================ */

CREATE DATABASE IF NOT EXISTS golego
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE golego;

SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW IF EXISTS v_accessibility_report_admin;

DROP TABLE IF EXISTS accessibility_audit_log;
DROP TABLE IF EXISTS report_photo;
DROP TABLE IF EXISTS accessibility_report;
DROP TABLE IF EXISTS bookmark_item;
DROP TABLE IF EXISTS bookmark_group;
DROP TABLE IF EXISTS user_auth_providers;
DROP TABLE IF EXISTS emergency_match;
DROP TABLE IF EXISTS facility_detail;
DROP TABLE IF EXISTS facility_master;
DROP TABLE IF EXISTS navigation_photo;
DROP TABLE IF EXISTS building_entrance;
DROP TABLE IF EXISTS path_connection;
DROP TABLE IF EXISTS place_accessibility;
DROP TABLE IF EXISTS poi_detail;
DROP TABLE IF EXISTS poi_core;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

/* ============================================================
   1. users
   ------------------------------------------------------------
   서비스 내부 사용자 마스터 테이블이다.

   주의:
   - 휠체어, 유모차 등 이동 유형은 users에 저장하지 않는다.
   - 이동 유형은 길찾기 API 호출 시 mobility_type 파라미터로 받는다.
   - 이 테이블에는 계정 권한, 상태, 기본 프로필 정보만 저장한다.
   ============================================================ */

CREATE TABLE users (
    user_id CHAR(36) NOT NULL COMMENT '서비스 내부 사용자 UUID',
    email VARCHAR(255) NOT NULL COMMENT '사용자 대표 이메일',
    nickname VARCHAR(100) NULL COMMENT '서비스 표시 이름',
    profile_image_url VARCHAR(500) NULL COMMENT '프로필 이미지 URL',
    role ENUM('USER', 'VOLUNTEER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER' COMMENT '서비스 권한',
    status ENUM('ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'ACTIVE' COMMENT '계정 상태',
    last_login_at DATETIME NULL COMMENT '마지막 로그인 시각',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
    deleted_at DATETIME NULL COMMENT '탈퇴 또는 소프트 삭제 시각',

    PRIMARY KEY (user_id),
    UNIQUE KEY uk_users_email (email),
    KEY idx_users_role_status (role, status),
    KEY idx_users_created_at (created_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='서비스 사용자 마스터';

/* ============================================================
   2. user_auth_providers
   ------------------------------------------------------------
   Google OAuth, Kakao, Naver, Apple, Local 로그인 등
   사용자 인증 제공자를 분리 저장하는 테이블이다.

   하나의 users 계정은 여러 인증 제공자를 연결할 수 있다.
   예: 동일 사용자 계정에 GOOGLE, KAKAO 로그인 연결 가능
   ============================================================ */

CREATE TABLE user_auth_providers (
    auth_provider_id CHAR(36) NOT NULL COMMENT '인증 제공자 연결 UUID',
    user_id CHAR(36) NOT NULL COMMENT '서비스 내부 사용자 UUID',
    provider ENUM('GOOGLE', 'KAKAO', 'NAVER', 'APPLE', 'LOCAL') NOT NULL COMMENT '인증 제공자',
    provider_user_id VARCHAR(255) NOT NULL COMMENT 'OAuth 제공자가 발급한 사용자 고유 ID',
    provider_email VARCHAR(255) NULL COMMENT 'OAuth 제공자에서 받은 이메일',
    connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '연결 시각',
    last_used_at DATETIME NULL COMMENT '마지막 인증 사용 시각',

    PRIMARY KEY (auth_provider_id),
    UNIQUE KEY uk_auth_provider_user (provider, provider_user_id),
    KEY idx_auth_user_id (user_id),
    KEY idx_auth_provider_email (provider_email),

    CONSTRAINT fk_auth_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자 외부 인증 제공자 연결 정보';

/* ============================================================
   3. poi_core
   ------------------------------------------------------------
   경로 탐색과 지도 렌더링에 필요한 가벼운 POI 핵심 정보다.

   설계 원칙:
   - 위치, 타입, 활성 여부처럼 자주 조회되는 필드만 둔다.
   - 사진 URL, 긴 설명, 외부 API ID는 이 테이블에 넣지 않는다.
   - 대용량 LBS 서비스에서 가장 자주 읽히는 테이블이므로 최대한 가볍게 유지한다.
   ============================================================ */

CREATE TABLE poi_core (
    poi_id CHAR(36) NOT NULL COMMENT 'POI UUID',
    poi_name VARCHAR(150) NOT NULL COMMENT '지점명',
    poi_type ENUM(
        'BUILDING',
        'ENTRANCE',
        'RAMP',
        'STAIR',
        'ELEVATOR',
        'RESTROOM',
        'CROSSWALK',
        'SIDEWALK',
        'GATE',
        'BUS_STOP',
        'SUBWAY_EXIT',
        'CHARGING_STATION',
        'HELP_DESK',
        'ETC'
    ) NOT NULL COMMENT 'POI 유형',
    latitude DECIMAL(10, 8) NOT NULL COMMENT '위도 WGS84',
    longitude DECIMAL(11, 8) NOT NULL COMMENT '경도 WGS84',
    floor_info VARCHAR(20) NULL COMMENT '층 정보',
    is_indoor BOOLEAN NOT NULL DEFAULT FALSE COMMENT '실내 여부',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '서비스 사용 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (poi_id),
    KEY idx_poi_type (poi_type),
    KEY idx_poi_lat_lng (latitude, longitude),
    KEY idx_poi_type_active (poi_type, is_active),
    KEY idx_poi_name (poi_name)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='경로 탐색 및 지도 렌더링용 POI 핵심 정보';

/* ============================================================
   4. poi_detail
   ------------------------------------------------------------
   POI의 상세 정보 테이블이다.

   poi_core와 1:1 관계이며, 외부 지도 API 식별자를 저장한다.
   google_place_id, kakao_place_id는 경로 탐색 자체에는 필요하지 않으므로
   poi_core가 아니라 poi_detail에 둔다.
   ============================================================ */

CREATE TABLE poi_detail (
    poi_id CHAR(36) NOT NULL COMMENT 'POI UUID',
    description TEXT NULL COMMENT 'POI 상세 설명',
    accessibility_memo TEXT NULL COMMENT '접근성 관련 관리자 메모',
    operating_hours VARCHAR(255) NULL COMMENT '운영 시간',
    contact_phone VARCHAR(50) NULL COMMENT '문의 전화',
    address VARCHAR(255) NULL COMMENT '주소',
    google_place_id VARCHAR(255) NULL COMMENT 'Google Places API 장소 식별자',
    kakao_place_id VARCHAR(255) NULL COMMENT 'Kakao Local API 장소 식별자',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (poi_id),
    UNIQUE KEY uk_poi_detail_google_place_id (google_place_id),
    UNIQUE KEY uk_poi_detail_kakao_place_id (kakao_place_id),
    KEY idx_poi_detail_address (address),

    CONSTRAINT fk_poi_detail_core
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='POI 상세 정보 및 외부 지도 API 매핑 정보';

/* ============================================================
   5. path_connection
   ------------------------------------------------------------
   POI 간 유향 그래프 연결 정보다.

   휠체어 사용자는 오르막과 내리막의 체감 난이도가 다르므로
   start_poi_id와 end_poi_id를 복합 PK로 사용한다.

   Neo4j 동기화 원천 데이터로도 사용된다.
   ============================================================ */

CREATE TABLE path_connection (
    start_poi_id CHAR(36) NOT NULL COMMENT '출발 POI UUID',
    end_poi_id CHAR(36) NOT NULL COMMENT '도착 POI UUID',
    path_type ENUM(
        'SIDEWALK',
        'RAMP',
        'STAIR',
        'ELEVATOR',
        'CROSSWALK',
        'INDOOR',
        'ROAD',
        'ETC'
    ) NOT NULL DEFAULT 'SIDEWALK' COMMENT '경로 유형',
    distance_m DECIMAL(10, 2) NOT NULL COMMENT '거리 meter',
    slope_degree DECIMAL(6, 2) NULL COMMENT '경사도. 오르막 양수, 내리막 음수',
    effort_level TINYINT UNSIGNED NOT NULL COMMENT '휠체어 또는 보행 보조기기 기준 체감 난이도 1~5',
    path_width_m DECIMAL(5, 2) NULL COMMENT '통행 가능 폭 meter',
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT TRUE COMMENT '휠체어 통행 가능 여부',
    stroller_accessible BOOLEAN NOT NULL DEFAULT TRUE COMMENT '유모차 통행 가능 여부',
    has_stairs BOOLEAN NOT NULL DEFAULT FALSE COMMENT '경로 구간에 계단 포함 여부',
    has_ramp BOOLEAN NOT NULL DEFAULT FALSE COMMENT '경로 구간에 경사로 포함 여부',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '현재 통행 가능 여부',
    sync_to_neo4j BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Neo4j 동기화 대상 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (start_poi_id, end_poi_id),
    KEY idx_path_end_poi (end_poi_id),
    KEY idx_path_type_active (path_type, is_active),
    KEY idx_path_wheelchair_active (wheelchair_accessible, is_active),
    KEY idx_path_stroller_active (stroller_accessible, is_active),
    KEY idx_path_mobility_filter (is_active, wheelchair_accessible, stroller_accessible, has_stairs, has_ramp),
    KEY idx_path_sync (sync_to_neo4j, updated_at),

    CONSTRAINT chk_path_not_self
        CHECK (start_poi_id <> end_poi_id),

    CONSTRAINT chk_path_effort_level
        CHECK (effort_level BETWEEN 1 AND 5),

    CONSTRAINT chk_path_distance
        CHECK (distance_m > 0),

    CONSTRAINT fk_path_start_poi
        FOREIGN KEY (start_poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_path_end_poi
        FOREIGN KEY (end_poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='POI 간 유향 경로 그래프 연결 정보';

/* ============================================================
   6. building_entrance
   ------------------------------------------------------------
   건물 POI와 출입구 POI를 연결하는 테이블이다.

   이번 프론트엔드 기획의 핵심:
   목적지 검색 시 특정 건물의 모든 출입구를 조회하고,
   API에서 받은 mobility_type에 따라 출입구를 필터링한다.

   예:
   - WHEELCHAIR: wheelchair_accessible = TRUE, has_stairs = FALSE 중심
   - STROLLER  : stroller_accessible = TRUE, has_stairs = FALSE 중심
   - GENERAL   : is_active = TRUE 중심
   ============================================================ */

CREATE TABLE building_entrance (
    building_poi_id CHAR(36) NOT NULL COMMENT '건물 POI UUID',
    entrance_poi_id CHAR(36) NOT NULL COMMENT '입구 POI UUID',
    entrance_type ENUM('MAIN', 'SUB', 'ACCESSIBLE', 'STAIR_ONLY', 'EMERGENCY', 'ETC') NOT NULL DEFAULT 'ETC' COMMENT '입구 유형',
    has_stairs BOOLEAN NOT NULL DEFAULT FALSE COMMENT '입구에 계단이 있는지 여부',
    has_ramp BOOLEAN NOT NULL DEFAULT FALSE COMMENT '입구에 경사로가 있는지 여부',
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT FALSE COMMENT '휠체어 접근 가능 여부',
    stroller_accessible BOOLEAN NOT NULL DEFAULT FALSE COMMENT '유모차 접근 가능 여부',
    entrance_width_cm DECIMAL(6, 2) NULL COMMENT '입구 통과 가능 폭 cm',
    threshold_height_cm DECIMAL(6, 2) NULL COMMENT '문턱 또는 단차 높이 cm',
    slope_degree DECIMAL(6, 2) NULL COMMENT '입구 접근 경사도',
    effort_level TINYINT UNSIGNED NOT NULL DEFAULT 3 COMMENT '입구 진입 난이도 1~5',
    is_recommended BOOLEAN NOT NULL DEFAULT FALSE COMMENT '교통약자 추천 입구 여부',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '현재 사용 가능한 입구 여부',
    display_order INT NOT NULL DEFAULT 0 COMMENT '표시 순서',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (building_poi_id, entrance_poi_id),
    KEY idx_building_entrance_entrance (entrance_poi_id),
    KEY idx_building_entrance_recommended (building_poi_id, is_recommended, is_active),
    KEY idx_building_entrance_wheelchair (building_poi_id, wheelchair_accessible, has_stairs, has_ramp, is_active),
    KEY idx_building_entrance_stroller (building_poi_id, stroller_accessible, has_stairs, has_ramp, is_active),
    KEY idx_building_entrance_cost (building_poi_id, effort_level, slope_degree, threshold_height_cm),

    CONSTRAINT chk_building_entrance_not_same
        CHECK (building_poi_id <> entrance_poi_id),

    CONSTRAINT chk_building_entrance_effort
        CHECK (effort_level BETWEEN 1 AND 5),

    CONSTRAINT chk_building_entrance_width
        CHECK (entrance_width_cm IS NULL OR entrance_width_cm >= 0),

    CONSTRAINT chk_building_entrance_threshold
        CHECK (threshold_height_cm IS NULL OR threshold_height_cm >= 0),

    CONSTRAINT fk_building_entrance_building
        FOREIGN KEY (building_poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_building_entrance_entrance
        FOREIGN KEY (entrance_poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='건물과 출입구 POI 매핑 및 이동 유형별 출입구 필터링 정보';

/* ============================================================
   7. navigation_photo
   ------------------------------------------------------------
   팀이 자체 수집한 길 안내용 마스터 사진 테이블이다.

   사용자 제보 사진(report_photo)과 분리한다.

   연결 대상:
   1. 특정 POI 사진
   2. 특정 path_connection 구간 사진

   사용 예:
   - 건물 입구 사진
   - 경로 꺾임점 사진
   - 엘리베이터 앞 사진
   - 경사로 사진
   - 방향 안내용 사진
   - 파노라마 사진
   ============================================================ */

CREATE TABLE navigation_photo (
    navigation_photo_id CHAR(36) NOT NULL COMMENT '길 안내용 사진 UUID',
    poi_id CHAR(36) NULL COMMENT '특정 POI에 연결되는 사진인 경우 POI UUID',
    path_start_poi_id CHAR(36) NULL COMMENT '특정 경로 구간 사진인 경우 출발 POI UUID',
    path_end_poi_id CHAR(36) NULL COMMENT '특정 경로 구간 사진인 경우 도착 POI UUID',
    photo_usage ENUM(
        'POI_MAIN',
        'ENTRANCE',
        'TURN_GUIDE',
        'PATH_SEGMENT',
        'RAMP',
        'STAIR',
        'ELEVATOR',
        'RESTROOM',
        'PANORAMA',
        'ETC'
    ) NOT NULL DEFAULT 'ETC' COMMENT '사진 사용 목적',
    file_url VARCHAR(1000) NOT NULL COMMENT '지도 또는 관리자 화면에서 접근 가능한 이미지 URL',
    storage_key VARCHAR(500) NOT NULL COMMENT 'S3 object key 또는 파일 서버 내부 경로',
    original_filename VARCHAR(255) NULL COMMENT '원본 파일명',
    mime_type VARCHAR(100) NOT NULL COMMENT 'MIME 타입',
    file_size_bytes BIGINT UNSIGNED NULL COMMENT '파일 크기 byte',
    checksum_sha256 CHAR(64) NULL COMMENT '파일 무결성 검증용 SHA-256',
    width INT UNSIGNED NULL COMMENT '이미지 너비',
    height INT UNSIGNED NULL COMMENT '이미지 높이',
    shooting_direction_degree DECIMAL(6, 2) NULL COMMENT '촬영 방향 각도. 방향 안내 사진에 사용',
    display_order INT NOT NULL DEFAULT 0 COMMENT '표시 순서',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE COMMENT '대표 사진 여부',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '서비스 노출 여부',
    uploaded_by_user_id CHAR(36) NULL COMMENT '업로드한 관리자 또는 데이터 수집자 UUID',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (navigation_photo_id),
    UNIQUE KEY uk_navigation_photo_storage_key (storage_key),
    KEY idx_navigation_photo_poi (poi_id, is_active, is_primary, display_order),
    KEY idx_navigation_photo_path (path_start_poi_id, path_end_poi_id, is_active, display_order),
    KEY idx_navigation_photo_usage (photo_usage, is_active),
    KEY idx_navigation_photo_uploader (uploaded_by_user_id),

    CONSTRAINT chk_navigation_photo_target
        CHECK (
            (poi_id IS NOT NULL AND path_start_poi_id IS NULL AND path_end_poi_id IS NULL)
            OR
            (poi_id IS NULL AND path_start_poi_id IS NOT NULL AND path_end_poi_id IS NOT NULL)
        ),

    CONSTRAINT fk_navigation_photo_poi
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_navigation_photo_path
        FOREIGN KEY (path_start_poi_id, path_end_poi_id)
        REFERENCES path_connection(start_poi_id, end_poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_navigation_photo_uploader
        FOREIGN KEY (uploaded_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='자체 수집한 POI 및 경로 구간별 길 안내용 사진 메타데이터';

/* ============================================================
   8. facility_master
   ------------------------------------------------------------
   장애인 화장실, 엘리베이터, 충전소 등 편의시설의 마스터 테이블이다.

   POI와 연결되며, 지도 필터링 레이어에서 사용된다.
   ============================================================ */

CREATE TABLE facility_master (
    facility_id CHAR(36) NOT NULL COMMENT '시설 UUID',
    poi_id CHAR(36) NOT NULL COMMENT '연결된 POI UUID',
    facility_type ENUM(
        'ACCESSIBLE_RESTROOM',
        'ELEVATOR',
        'RAMP',
        'LOW_FLOOR_BUS_STOP',
        'WHEELCHAIR_CHARGER',
        'HELP_DESK',
        'BENCH',
        'ETC'
    ) NOT NULL COMMENT '시설 유형',
    facility_name VARCHAR(150) NOT NULL COMMENT '시설명',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '운영 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (facility_id),
    KEY idx_facility_poi (poi_id),
    KEY idx_facility_type_active (facility_type, is_active),

    CONSTRAINT fk_facility_master_poi
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='편의시설 마스터';

/* ============================================================
   9. facility_detail
   ------------------------------------------------------------
   편의시설의 상세 접근성, 운영 시간, 연락처 등을 저장한다.

   facility_master와 1:1 관계다.
   ============================================================ */

CREATE TABLE facility_detail (
    facility_id CHAR(36) NOT NULL COMMENT '시설 UUID',
    operating_hours VARCHAR(255) NULL COMMENT '운영 시간',
    contact_phone VARCHAR(50) NULL COMMENT '문의 전화',
    has_step_free_access BOOLEAN NULL COMMENT '무단차 접근 가능 여부',
    has_auto_door BOOLEAN NULL COMMENT '자동문 여부',
    door_width_cm DECIMAL(6, 2) NULL COMMENT '문 폭 cm',
    ramp_slope_degree DECIMAL(6, 2) NULL COMMENT '경사로 경사도',
    restroom_gender_type ENUM('MALE', 'FEMALE', 'UNISEX', 'UNKNOWN') NULL COMMENT '화장실 성별 구분',
    description TEXT NULL COMMENT '상세 설명',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (facility_id),

    CONSTRAINT chk_facility_door_width
        CHECK (door_width_cm IS NULL OR door_width_cm >= 0),

    CONSTRAINT fk_facility_detail_master
        FOREIGN KEY (facility_id)
        REFERENCES facility_master(facility_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='편의시설 상세 정보';

/* ============================================================
   10. place_accessibility
   ------------------------------------------------------------
   장소별 휠체어 진입 가능 여부의 현재 상태 Snapshot 테이블이다.

   현재 상태만 저장한다.
   과거 승인, 반려, 수동 변경 이력은 accessibility_audit_log에 저장한다.

   외부 지도 API 기반 장소도 관리할 수 있도록
   google_place_id와 kakao_place_id를 둔다.
   ============================================================ */

CREATE TABLE place_accessibility (
    place_accessibility_id CHAR(36) NOT NULL COMMENT '장소 접근성 UUID',
    poi_id CHAR(36) NULL COMMENT '내부 POI와 연결되는 경우의 POI UUID',
    google_place_id VARCHAR(255) NULL COMMENT 'Google Places API 장소 식별자',
    kakao_place_id VARCHAR(255) NULL COMMENT 'Kakao Local API 장소 식별자',
    place_name VARCHAR(150) NOT NULL COMMENT '장소명',
    place_address VARCHAR(255) NULL COMMENT '주소',
    latitude DECIMAL(10, 8) NULL COMMENT '위도',
    longitude DECIMAL(11, 8) NULL COMMENT '경도',
    wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') NOT NULL DEFAULT 'UNKNOWN' COMMENT '현재 휠체어 진입 가능 상태',
    verification_status ENUM('UNVERIFIED', 'VERIFIED', 'NEEDS_RECHECK') NOT NULL DEFAULT 'UNVERIFIED' COMMENT '검증 상태',
    source_report_id CHAR(36) NULL COMMENT '현재 상태의 근거가 된 최신 제보 ID',
    last_verified_by_user_id CHAR(36) NULL COMMENT '마지막 검증 관리자 ID',
    last_verified_at DATETIME NULL COMMENT '마지막 검증 시각',
    status_reason VARCHAR(500) NULL COMMENT '현재 상태 사유',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '서비스 노출 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (place_accessibility_id),
    UNIQUE KEY uk_place_accessibility_google_place_id (google_place_id),
    UNIQUE KEY uk_place_accessibility_kakao_place_id (kakao_place_id),
    KEY idx_place_accessibility_poi (poi_id),
    KEY idx_place_accessibility_location (latitude, longitude),
    KEY idx_place_accessibility_status (wheelchair_access_status, verification_status),
    KEY idx_place_accessibility_name (place_name),
    KEY idx_place_accessibility_source_report (source_report_id),
    KEY idx_place_accessibility_verifier (last_verified_by_user_id),

    CONSTRAINT fk_place_accessibility_poi
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_place_accessibility_verifier
        FOREIGN KEY (last_verified_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='장소별 휠체어 진입 가능 여부 현재 상태';

/* ============================================================
   11. accessibility_report
   ------------------------------------------------------------
   사용자 위험 구간 제보 테이블이다.

   이번 프론트엔드 기획 반영:
   - AI 분석 결과 저장 컬럼 없음
   - category는 한글 ENUM 사용
   - 사용자가 슬라이더로 입력하는 경사도 추정치 0~100%를 slope_estimate_percent에 저장
   ============================================================ */

CREATE TABLE accessibility_report (
    report_id CHAR(36) NOT NULL COMMENT '제보 UUID',
    user_id CHAR(36) NULL COMMENT '제보 사용자 UUID. 비회원 제보 허용 시 NULL 가능',
    poi_id CHAR(36) NULL COMMENT '연결된 내부 POI UUID',
    place_accessibility_id CHAR(36) NULL COMMENT '기존 접근성 장소와 연결되는 경우',
    place_name VARCHAR(150) NOT NULL COMMENT '제보 장소명',
    place_address VARCHAR(255) NULL COMMENT '제보 장소 주소',
    latitude DECIMAL(10, 8) NULL COMMENT '제보 위도',
    longitude DECIMAL(11, 8) NULL COMMENT '제보 경도',
    category ENUM(
        '급경사',
        '파손 보도',
        '단차',
        '미끄러운 노면',
        '공사 통제',
        '기타'
    ) NOT NULL COMMENT '프론트엔드 제보 UI의 위험 유형',
    slope_estimate_percent DECIMAL(5, 2) NULL COMMENT '사용자가 슬라이더로 입력한 경사도 추정치 0~100%',
    requested_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') NOT NULL DEFAULT 'UNKNOWN' COMMENT '사용자가 제보한 휠체어 진입 상태',
    description TEXT NULL COMMENT '사용자 상세 설명',
    report_status ENUM('PENDING', 'APPROVED', 'REJECTED', 'DELETED') NOT NULL DEFAULT 'PENDING' COMMENT '관리자 처리 상태',
    review_comment VARCHAR(1000) NULL COMMENT '관리자 검토 의견 또는 반려 사유',
    reviewed_by_user_id CHAR(36) NULL COMMENT '검토 관리자 UUID',
    reviewed_at DATETIME NULL COMMENT '검토 시각',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '제보 생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '제보 수정 시각',

    PRIMARY KEY (report_id),
    KEY idx_report_user (user_id, created_at),
    KEY idx_report_poi (poi_id),
    KEY idx_report_place_accessibility (place_accessibility_id),
    KEY idx_report_status_created (report_status, created_at),
    KEY idx_report_category_status (category, report_status),
    KEY idx_report_location (latitude, longitude),
    KEY idx_report_reviewer (reviewed_by_user_id),

    CONSTRAINT chk_report_slope_estimate
        CHECK (slope_estimate_percent IS NULL OR slope_estimate_percent BETWEEN 0 AND 100),

    CONSTRAINT fk_report_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_report_poi
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_report_place_accessibility
        FOREIGN KEY (place_accessibility_id)
        REFERENCES place_accessibility(place_accessibility_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_report_reviewer
        FOREIGN KEY (reviewed_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자 위험 구간 및 접근성 제보';

/* ============================================================
   place_accessibility.source_report_id FK 추가
   ------------------------------------------------------------
   place_accessibility와 accessibility_report 사이에 순환 참조가 있으므로
   accessibility_report 생성 이후 FK를 추가한다.
   ============================================================ */

ALTER TABLE place_accessibility
    ADD CONSTRAINT fk_place_accessibility_source_report
    FOREIGN KEY (source_report_id)
    REFERENCES accessibility_report(report_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

/* ============================================================
   12. report_photo
   ------------------------------------------------------------
   사용자 제보 사진 메타데이터 테이블이다.

   주의:
   - 실제 이미지는 S3, NCP Object Storage, 로컬 파일 서버 등에 저장한다.
   - DB에는 URL, storage_key, MIME, 크기, checksum 등 운영 메타데이터만 저장한다.
   ============================================================ */

CREATE TABLE report_photo (
    photo_id CHAR(36) NOT NULL COMMENT '제보 사진 UUID',
    report_id CHAR(36) NOT NULL COMMENT '제보 UUID',
    file_url VARCHAR(1000) NOT NULL COMMENT '관리자 화면에서 접근 가능한 이미지 URL',
    storage_key VARCHAR(500) NOT NULL COMMENT 'S3 object key 또는 파일 서버 내부 경로',
    original_filename VARCHAR(255) NULL COMMENT '원본 파일명',
    mime_type VARCHAR(100) NOT NULL COMMENT 'MIME 타입',
    file_size_bytes BIGINT UNSIGNED NULL COMMENT '파일 크기 byte',
    checksum_sha256 CHAR(64) NULL COMMENT '파일 무결성 검증용 SHA-256',
    width INT UNSIGNED NULL COMMENT '이미지 너비',
    height INT UNSIGNED NULL COMMENT '이미지 높이',
    photo_type ENUM(
        'ENTRANCE_FRONT',
        'THRESHOLD',
        'RAMP',
        'DOOR_WIDTH',
        'ELEVATOR',
        'OBSTACLE',
        'CONSTRUCTION',
        'ROAD_SURFACE',
        'ETC'
    ) NOT NULL DEFAULT 'ETC' COMMENT '사진 증빙 유형',
    upload_status ENUM('UPLOADING', 'COMPLETED', 'FAILED', 'DELETED') NOT NULL DEFAULT 'COMPLETED' COMMENT '파일 업로드 상태',
    display_order INT NOT NULL DEFAULT 0 COMMENT '표시 순서',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE COMMENT '소프트 삭제 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    deleted_at DATETIME NULL COMMENT '삭제 시각',

    PRIMARY KEY (photo_id),
    UNIQUE KEY uk_report_photo_storage_key (storage_key),
    KEY idx_report_photo_report (report_id, is_deleted, display_order),
    KEY idx_report_photo_type (photo_type),
    KEY idx_report_photo_upload_status (upload_status),

    CONSTRAINT fk_report_photo_report
        FOREIGN KEY (report_id)
        REFERENCES accessibility_report(report_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자 제보 사진 메타데이터';

/* ============================================================
   13. accessibility_audit_log
   ------------------------------------------------------------
   접근성 상태 변경 이력 테이블이다.

   지난 승인 페이지, 사후 상태 변경, 공사/파손으로 인한 재검토 이력을 지원한다.

   place_accessibility는 현재 상태만 저장하고,
   이 테이블은 승인/반려/수동 변경 이력을 append-only 방식으로 보존한다.
   ============================================================ */

CREATE TABLE accessibility_audit_log (
    audit_log_id CHAR(36) NOT NULL COMMENT '접근성 변경 이력 UUID',
    place_accessibility_id CHAR(36) NULL COMMENT '변경 대상 장소 접근성 UUID',
    report_id CHAR(36) NULL COMMENT '변경 근거가 된 제보 UUID',
    action_type ENUM(
        'CREATE',
        'APPROVE_REPORT',
        'REJECT_REPORT',
        'MANUAL_UPDATE',
        'MARK_NEEDS_RECHECK',
        'DELETE',
        'RESTORE'
    ) NOT NULL COMMENT '변경 행위 유형',
    old_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') NULL COMMENT '변경 전 휠체어 진입 상태',
    new_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') NULL COMMENT '변경 후 휠체어 진입 상태',
    old_verification_status ENUM('UNVERIFIED', 'VERIFIED', 'NEEDS_RECHECK') NULL COMMENT '변경 전 검증 상태',
    new_verification_status ENUM('UNVERIFIED', 'VERIFIED', 'NEEDS_RECHECK') NULL COMMENT '변경 후 검증 상태',
    changed_by_user_id CHAR(36) NULL COMMENT '변경한 관리자 또는 시스템 사용자 UUID',
    change_reason VARCHAR(1000) NULL COMMENT '변경 사유',
    admin_memo TEXT NULL COMMENT '관리자 내부 메모',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '이력 생성 시각',

    PRIMARY KEY (audit_log_id),
    KEY idx_audit_place_created (place_accessibility_id, created_at),
    KEY idx_audit_report (report_id),
    KEY idx_audit_action_created (action_type, created_at),
    KEY idx_audit_changed_by (changed_by_user_id, created_at),

    CONSTRAINT fk_audit_place_accessibility
        FOREIGN KEY (place_accessibility_id)
        REFERENCES place_accessibility(place_accessibility_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_audit_report
        FOREIGN KEY (report_id)
        REFERENCES accessibility_report(report_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    CONSTRAINT fk_audit_changed_by
        FOREIGN KEY (changed_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='접근성 승인, 반려, 수동 변경 감사 로그';

/* ============================================================
   14. bookmark_group
   ------------------------------------------------------------
   사용자별 즐겨찾기 폴더 테이블이다.

   사용자는 여러 즐겨찾기 그룹을 가질 수 있다.
   예: 자주 가는 강의실, 화장실, 안전한 경로, 즐겨찾는 건물 등
   ============================================================ */

CREATE TABLE bookmark_group (
    bookmark_group_id CHAR(36) NOT NULL COMMENT '즐겨찾기 그룹 UUID',
    user_id CHAR(36) NOT NULL COMMENT '사용자 UUID',
    group_name VARCHAR(100) NOT NULL COMMENT '즐겨찾기 그룹명',
    display_order INT NOT NULL DEFAULT 0 COMMENT '사용자 화면 표시 순서',
    is_default BOOLEAN NOT NULL DEFAULT FALSE COMMENT '기본 그룹 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (bookmark_group_id),
    UNIQUE KEY uk_bookmark_group_user_name (user_id, group_name),
    KEY idx_bookmark_group_user_order (user_id, display_order),

    CONSTRAINT fk_bookmark_group_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='사용자별 즐겨찾기 그룹';

/* ============================================================
   15. bookmark_item
   ------------------------------------------------------------
   즐겨찾기 항목 테이블이다.

   즐겨찾기 대상은 다음 중 하나다.
   1. 내부 POI
   2. 외부 장소 기반 place_accessibility

   그룹이 삭제되면 하위 즐겨찾기 항목도 삭제된다.
   ============================================================ */

CREATE TABLE bookmark_item (
    bookmark_item_id CHAR(36) NOT NULL COMMENT '즐겨찾기 항목 UUID',
    bookmark_group_id CHAR(36) NOT NULL COMMENT '즐겨찾기 그룹 UUID',
    user_id CHAR(36) NOT NULL COMMENT '조회 최적화를 위한 사용자 UUID',
    poi_id CHAR(36) NULL COMMENT '내부 POI 즐겨찾기 대상',
    place_accessibility_id CHAR(36) NULL COMMENT '외부 또는 접근성 장소 즐겨찾기 대상',
    custom_name VARCHAR(150) NULL COMMENT '사용자가 지정한 별칭',
    memo VARCHAR(500) NULL COMMENT '사용자 메모',
    display_order INT NOT NULL DEFAULT 0 COMMENT '그룹 내 표시 순서',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',

    PRIMARY KEY (bookmark_item_id),
    KEY idx_bookmark_item_group_order (bookmark_group_id, display_order),
    KEY idx_bookmark_item_user_created (user_id, created_at),
    KEY idx_bookmark_item_poi (poi_id),
    KEY idx_bookmark_item_place_accessibility (place_accessibility_id),
    UNIQUE KEY uk_bookmark_item_group_poi (bookmark_group_id, poi_id),
    UNIQUE KEY uk_bookmark_item_group_place (bookmark_group_id, place_accessibility_id),

    CONSTRAINT chk_bookmark_target_exists
        CHECK (poi_id IS NOT NULL OR place_accessibility_id IS NOT NULL),

    CONSTRAINT fk_bookmark_item_group
        FOREIGN KEY (bookmark_group_id)
        REFERENCES bookmark_group(bookmark_group_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_bookmark_item_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_bookmark_item_poi
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_bookmark_item_place_accessibility
        FOREIGN KEY (place_accessibility_id)
        REFERENCES place_accessibility(place_accessibility_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='즐겨찾기 항목';

/* ============================================================
   16. emergency_match
   ------------------------------------------------------------
   긴급 도움 요청자와 봉사자 매칭 테이블이다.

   MVP 이후 긴급 봉사자 매칭, 위치 공유, 상태 추적 기능에 사용한다.
   ============================================================ */

CREATE TABLE emergency_match (
    request_id CHAR(36) NOT NULL COMMENT '긴급 요청 UUID',
    requester_id CHAR(36) NOT NULL COMMENT '도움 요청 사용자 UUID',
    volunteer_id CHAR(36) NULL COMMENT '매칭된 봉사자 UUID',
    request_latitude DECIMAL(10, 8) NOT NULL COMMENT '요청 위치 위도',
    request_longitude DECIMAL(11, 8) NOT NULL COMMENT '요청 위치 경도',
    request_message VARCHAR(1000) NULL COMMENT '요청 메시지',
    match_status ENUM('REQUESTED', 'MATCHED', 'COMPLETED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'REQUESTED' COMMENT '매칭 상태',
    requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '요청 시각',
    matched_at DATETIME NULL COMMENT '매칭 시각',
    completed_at DATETIME NULL COMMENT '완료 시각',
    cancelled_at DATETIME NULL COMMENT '취소 시각',

    PRIMARY KEY (request_id),
    KEY idx_emergency_requester (requester_id, requested_at),
    KEY idx_emergency_volunteer (volunteer_id, requested_at),
    KEY idx_emergency_status_location (match_status, request_latitude, request_longitude),

    CONSTRAINT fk_emergency_requester
        FOREIGN KEY (requester_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_emergency_volunteer
        FOREIGN KEY (volunteer_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='긴급 도움 요청 및 봉사자 매칭';

/* ============================================================
   17. v_accessibility_report_admin
   ------------------------------------------------------------
   관리자 제보 목록 조회용 View다.

   제보 기본 정보와 사진 개수를 함께 제공한다.
   관리자 페이지에서 PENDING 제보 목록, 승인/반려 대상 조회에 사용하기 좋다.
   ============================================================ */

CREATE OR REPLACE VIEW v_accessibility_report_admin AS
SELECT
    r.report_id,
    r.user_id,
    u.email AS reporter_email,
    r.poi_id,
    r.place_accessibility_id,
    r.place_name,
    r.place_address,
    r.latitude,
    r.longitude,
    r.category,
    r.slope_estimate_percent,
    r.requested_status,
    r.report_status,
    r.review_comment,
    r.reviewed_by_user_id,
    r.reviewed_at,
    r.created_at,
    COUNT(p.photo_id) AS photo_count
FROM accessibility_report r
LEFT JOIN users u
    ON r.user_id = u.user_id
LEFT JOIN report_photo p
    ON r.report_id = p.report_id
   AND p.is_deleted = FALSE
   AND p.upload_status = 'COMPLETED'
GROUP BY
    r.report_id,
    r.user_id,
    u.email,
    r.poi_id,
    r.place_accessibility_id,
    r.place_name,
    r.place_address,
    r.latitude,
    r.longitude,
    r.category,
    r.slope_estimate_percent,
    r.requested_status,
    r.report_status,
    r.review_comment,
    r.reviewed_by_user_id,
    r.reviewed_at,
    r.created_at;

/* ============================================================
   18. 운영 트랜잭션 권장 흐름
   ------------------------------------------------------------
   실제 승인/반려/상태 변경은 트리거보다 백엔드 서비스 레이어에서
   명시적 트랜잭션으로 처리하는 것을 권장한다.

   승인 처리 예:
   1. accessibility_report.report_status = 'APPROVED'
   2. place_accessibility INSERT 또는 UPDATE
   3. accessibility_audit_log INSERT
   4. COMMIT

   반려 처리 예:
   1. accessibility_report.report_status = 'REJECTED'
   2. accessibility_audit_log INSERT
   3. COMMIT

   사후 변경 예:
   1. place_accessibility 현재 상태 UPDATE
   2. accessibility_audit_log action_type = 'MANUAL_UPDATE' INSERT
   3. COMMIT
   ============================================================ */
