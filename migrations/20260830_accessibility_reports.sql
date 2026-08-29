ALTER TABLE user_report
  ADD COLUMN place_name VARCHAR(100) NULL AFTER poi_id,
  ADD COLUMN place_address VARCHAR(255) NULL AFTER place_name,
  ADD COLUMN wheelchair_access_status ENUM('UNKNOWN', 'ACCESSIBLE', 'NOT_ACCESSIBLE') DEFAULT 'UNKNOWN' AFTER category,
  ADD COLUMN reviewed_at TIMESTAMP NULL AFTER created_at;

CREATE TABLE IF NOT EXISTS place_accessibility (
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
