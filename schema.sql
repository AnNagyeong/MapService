/* ============================================================
   설계 목표:
   1. MySQL: 사용자, 인증, POI 마스터, 접근성 상태, 제보, 감사 로그 관리
   2. Neo4j: 경로 탐색용 그래프 데이터 단방향 동기화 대상
   3. 사진 데이터: DB에는 메타데이터만 저장, 실제 파일은 S3/파일 서버 저장
   4. 접근성 상태: 현재 상태와 변경 이력을 분리
   5. 즐겨찾기: 사용자별 그룹/폴더 구조 지원
   ============================================================ */

SET FOREIGN_KEY_CHECKS = 0; -- 외래키 제약조건 끄기

DROP TABLE IF EXISTS accessibility_audit_log;
DROP TABLE IF EXISTS report_photo;
DROP TABLE IF EXISTS accessibility_report;
DROP TABLE IF EXISTS bookmark_item;
DROP TABLE IF EXISTS bookmark_group;
DROP TABLE IF EXISTS user_auth_providers;
DROP TABLE IF EXISTS emergency_match;
DROP TABLE IF EXISTS facility_detail;
DROP TABLE IF EXISTS facility_master;
DROP TABLE IF EXISTS poi_panorama;
DROP TABLE IF EXISTS building_entrance;
DROP TABLE IF EXISTS path_connection;
DROP TABLE IF EXISTS place_accessibility;
DROP TABLE IF EXISTS poi_detail;
DROP TABLE IF EXISTS poi_core;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1; -- 외래키 제약조건 켜기

/* ============================================================
   📌1. USERS
   서비스 내부 사용자 마스터
   ============================================================ */

CREATE TABLE users (
    user_id CHAR(36) NOT NULL COMMENT '서비스 내부 사용자 UUID',
    email VARCHAR(255) NOT NULL COMMENT '사용자 대표 이메일',
    nickname VARCHAR(100) NULL COMMENT '서비스 표시 이름',
    profile_image_url VARCHAR(500) NULL COMMENT '프로필 이미지 URL',
    role ENUM('USER', 'VOLUNTEER', 'ADMIN', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER' COMMENT '사용자 권한',
    status ENUM('ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'ACTIVE' COMMENT '계정 상태',
    last_login_at DATETIME NULL COMMENT '마지막 로그인 시각',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
    deleted_at DATETIME NULL COMMENT '탈퇴 또는 삭제 시각',

    PRIMARY KEY (user_id),
    UNIQUE KEY uk_users_email (email),
    KEY idx_users_role_status (role, status),
    KEY idx_users_created_at (created_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='서비스 사용자 마스터';

/* ============================================================
   📌2. USER AUTH PROVIDERS
   Google OAuth 등 외부 인증 제공자 연결 정보
   ============================================================ */

CREATE TABLE user_auth_providers (
    auth_provider_id CHAR(36) NOT NULL COMMENT '인증 제공자 연결 UUID',
    user_id CHAR(36) NOT NULL COMMENT '서비스 내부 사용자 UUID',
    provider ENUM('GOOGLE', 'KAKAO', 'NAVER', 'APPLE', 'LOCAL') NOT NULL COMMENT '인증 제공자',
    provider_user_id VARCHAR(255) NOT NULL COMMENT 'OAuth 제공자가 발급한 사용자 고유 ID',
    provider_email VARCHAR(255) NULL COMMENT 'OAuth 제공자에서 받은 이메일',
    connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '연결 시각',
    last_used_at DATETIME NULL COMMENT '마지막 사용 시각',

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
   📌3. POI CORE
   경로 탐색과 지도 마커 렌더링에 필요한 가벼운 위치 중심 테이블
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
   📌4. POI DETAIL
   POI 상세 설명, 운영 메모 등 무거운 상세 정보
   poi_core와 1:1 식별 관계
   ============================================================ */

CREATE TABLE poi_detail (
    poi_id CHAR(36) NOT NULL COMMENT 'POI UUID',
    description TEXT NULL COMMENT 'POI 상세 설명',
    accessibility_memo TEXT NULL COMMENT '접근성 관련 관리자 메모',
    operating_hours VARCHAR(255) NULL COMMENT '운영 시간',
    contact_phone VARCHAR(50) NULL COMMENT '문의 전화',
    address VARCHAR(255) NULL COMMENT '주소',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (poi_id),

    CONSTRAINT fk_poi_detail_core
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='POI 상세 정보';

/* ============================================================
   📌5. POI PANORAMA
   POI 파노라마 및 현장 사진
   하나의 POI에 여러 장의 사진을 연결할 수 있음
   ============================================================ */

CREATE TABLE poi_panorama (
    panorama_id CHAR(36) NOT NULL COMMENT '파노라마 사진 UUID',
    poi_id CHAR(36) NOT NULL COMMENT 'POI UUID',
    file_url VARCHAR(1000) NOT NULL COMMENT '사진 접근 URL',
    storage_key VARCHAR(500) NOT NULL COMMENT 'S3 object key 또는 파일 서버 내부 경로',
    original_filename VARCHAR(255) NULL COMMENT '원본 파일명',
    mime_type VARCHAR(100) NOT NULL COMMENT 'MIME 타입',
    file_size_bytes BIGINT UNSIGNED NULL COMMENT '파일 크기 byte',
    width INT UNSIGNED NULL COMMENT '이미지 너비',
    height INT UNSIGNED NULL COMMENT '이미지 높이',
    display_order INT NOT NULL DEFAULT 0 COMMENT '표시 순서',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE COMMENT '대표 사진 여부',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE COMMENT '소프트 삭제 여부',
    uploaded_by_user_id CHAR(36) NULL COMMENT '업로드한 관리자 또는 사용자',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',

    PRIMARY KEY (panorama_id),
    KEY idx_panorama_poi (poi_id, is_deleted, display_order),
    KEY idx_panorama_uploader (uploaded_by_user_id),

    CONSTRAINT fk_panorama_poi
        FOREIGN KEY (poi_id)
        REFERENCES poi_core(poi_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_panorama_uploader
        FOREIGN KEY (uploaded_by_user_id)
        REFERENCES users(user_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='POI 파노라마 및 현장 사진 메타데이터';

/* ============================================================
   📌6. PATH CONNECTION
   POI 간 유향 그래프 연결 정보
   휠체어 경로는 방향별 오르막/내리막 난이도가 다르므로 복합 PK 사용
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
    effort_level TINYINT UNSIGNED NOT NULL COMMENT '휠체어 체감 난이도 1~5',
    path_width_m DECIMAL(5, 2) NULL COMMENT '통행 가능 폭 meter',
    wheelchair_accessible BOOLEAN NOT NULL DEFAULT TRUE COMMENT '휠체어 통행 가능 여부',
    is_active BOOLEAN NOT NULL DEFAULT TRUE COMMENT '현재 통행 가능 여부',
    sync_to_neo4j BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Neo4j 동기화 대상 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',

    PRIMARY KEY (start_poi_id, end_poi_id),
    KEY idx_path_end_poi (end_poi_id),
    KEY idx_path_type_active (path_type, is_active),
    KEY idx_path_wheelchair_active (wheelchair_accessible, is_active),
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
   📌7. BUILDING ENTRANCE
   건물과 실제 입구 POI 매핑
   ============================================================ */

CREATE TABLE building_entrance (
    building_poi_id CHAR(36) NOT NULL COMMENT '건물 POI UUID',
    entrance_poi_id CHAR(36) NOT NULL COMMENT '입구 POI UUID',
    entrance_type ENUM('MAIN', 'SUB', 'ACCESSIBLE', 'STAIR_ONLY', 'EMERGENCY', 'ETC') NOT NULL DEFAULT 'ETC' COMMENT '입구 유형',
    is_recommended BOOLEAN NOT NULL DEFAULT FALSE COMMENT '휠체어 사용자 추천 입구 여부',
    display_order INT NOT NULL DEFAULT 0 COMMENT '표시 순서',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',

    PRIMARY KEY (building_poi_id, entrance_poi_id),
    KEY idx_building_entrance_entrance (entrance_poi_id),
    KEY idx_building_entrance_recommended (building_poi_id, is_recommended),

    CONSTRAINT chk_building_entrance_not_same
        CHECK (building_poi_id <> entrance_poi_id),

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
  COMMENT='건물과 입구 POI 매핑';

/* ============================================================
   📌8. FACILITY MASTER
   편의시설 기본 마스터
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
   📌9. FACILITY DETAIL
   시설 상세 접근성/운영 정보
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
   📌10. PLACE ACCESSIBILITY
   장소별 휠체어 진입 가능 여부의 현재 상태 Snapshot
   관리자 승인 또는 운영자 수동 변경 후 최신 상태만 보관
   ============================================================ */

CREATE TABLE place_accessibility (
    place_accessibility_id CHAR(36) NOT NULL COMMENT '장소 접근성 UUID',
    poi_id CHAR(36) NULL COMMENT '내부 POI와 연결되는 경우의 POI UUID',
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
   📌11. ACCESSIBILITY REPORT
   사용자 접근성 제보
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
        'STEP',
        'STAIR',
        'RAMP',
        'DOOR_WIDTH',
        'ELEVATOR',
        'CONSTRUCTION',
        'ILLEGAL_PARKING',
        'OBSTACLE',
        'ACCESSIBILITY_STATUS',
        'ETC'
    ) NOT NULL DEFAULT 'ACCESSIBILITY_STATUS' COMMENT '제보 유형',
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
    KEY idx_report_location (latitude, longitude),
    KEY idx_report_reviewer (reviewed_by_user_id),

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
  COMMENT='사용자 접근성 제보';

/* source_report_id FK는 accessibility_report 생성 이후 추가 */
ALTER TABLE place_accessibility
    ADD CONSTRAINT fk_place_accessibility_source_report
    FOREIGN KEY (source_report_id)
    REFERENCES accessibility_report(report_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

/* ============================================================
   📌12. REPORT PHOTO
   제보 사진 1:N 저장
   실제 이미지는 파일 서버 또는 S3에 저장하고 DB에는 메타데이터 저장
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
        'ETC'
    ) NOT NULL DEFAULT 'ETC' COMMENT '사진 증빙 유형',
    upload_status ENUM('UPLOADING', 'COMPLETED', 'FAILED', 'DELETED') NOT NULL DEFAULT 'COMPLETED' COMMENT '파일 업로드 상태',
    display_order INT NOT NULL DEFAULT 0 COMMENT '표시 순서',
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE COMMENT '소프트 삭제 여부',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
    deleted_at DATETIME NULL COMMENT '삭제 시각',

    PRIMARY KEY (photo_id),
    KEY idx_report_photo_report (report_id, is_deleted, display_order),
    KEY idx_report_photo_type (photo_type),
    KEY idx_report_photo_upload_status (upload_status),
    UNIQUE KEY uk_report_photo_storage_key (storage_key),

    CONSTRAINT fk_report_photo_report
        FOREIGN KEY (report_id)
        REFERENCES accessibility_report(report_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='접근성 제보 사진 메타데이터';

/* ============================================================
   📌13. ACCESSIBILITY AUDIT LOG
   장소 접근성 상태 변경 이력
   지난 승인 페이지와 사후 변경 추적의 핵심 테이블
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
  COMMENT='접근성 상태 변경 및 승인/반려 감사 로그';

/* ============================================================
   📌14. BOOKMARK GROUP
   사용자별 즐겨찾기 폴더
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
   📌15. BOOKMARK ITEM
   즐겨찾기 항목
   내부 POI 또는 외부 장소 접근성 데이터 중 하나를 참조
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
   📌16. EMERGENCY MATCH
   긴급 도움 요청자와 봉사자 매칭
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
   📌17. 운영 조회 최적화용 View
   관리자 제보 목록에서 사진 개수를 함께 보기 위한 View
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
    r.requested_status,
    r.report_status,
    r.review_comment,
    r.reviewed_by_user_id,
    r.reviewed_at,
    r.created_at;

/* ============================================================
   📌18. 운영 트랜잭션 예시
   실제 API 서비스 레이어에서 아래 순서로 처리 권장

   승인 처리:
   1. accessibility_report 상태 APPROVED
   2. place_accessibility UPSERT
   3. accessibility_audit_log INSERT
   4. COMMIT

   MySQL DDL에는 프로시저를 강제하지 않고,
   애플리케이션 트랜잭션에서 처리하는 것을 권장
   ============================================================ */
