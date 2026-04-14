# 📍 Barrier-Free 지도 서비스 Servies System 설계

본 시스템은 교통약자(휠체어, 유모차 사용자 등)를 위해 경사도, 노면 상태, 장애물 정보를 반영한 __실시간 고정밀 내비게이션__ 을 제공하는 것을 목표로 합니다.

---

## 📌 1. 시스템 아키텍처 다이어그램

graph TD
    subgraph "1. 데이터 수집 계층 (Collection)"
        S1[Arduino + MPU6050 센서] -->|경사/진동 데이터| B
        S2[카메라/AI Vision] -->|장애물 인식 데이터| B
        S3[사용자 앱 리포트] -->|실시간 제보 사진/텍스트| B
        S4[공공 데이터 API] -->|엘리베이터/화장실 정보| B
    end

    subgraph "2. 데이터 처리 및 관리 계층 (Processing & Storage)"
        B[Backend API 서버]
        B -->|정제/매핑| DB1[(MySQL - RDB)]
        B -->|그래프 변환| DB2[(Neo4j - Graph DB)]
        
        DB1 ---|POI 속성 정보| DB2
        DB2 ---|최적 경로 연산| B
    end

    subgraph "3. 서비스 계층 (Service/UI)"
        B -->|REST API Response| F[Frontend - Web/App]
        F -->|Kakao Maps API| Map[지도 시각화 및 경로 표시]
    end

    %% 데이터 흐름 정의
    F -->|출발/도착 POI 요청| B
    B -->|Dijkstra/A* 알고리즘| DB2
    DB2 -->|노드-링크 좌표 리스트| B


---

## 📌 2. 모듈별 상세 설명 및 데이터 입출력
