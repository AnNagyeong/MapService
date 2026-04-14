# 📍 Barrier-Free 지도 서비스 Servies System 설계

본 시스템은 교통약자(휠체어, 유모차 사용자 등)를 위해 경사도, 노면 상태, 장애물 정보를 반영한 __실시간 고정밀 내비게이션__ 을 제공하는 것을 목표로 합니다.

---

## 📌 1. 시스템 아키텍처 다이어그램

```mermaid
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
```

---

## 📌 2. 모듈별 상세 설명 및 데이터 입출력
| 모듈명 | 주요 기능 및 역할 | Input | Output |
| :--- | :--- | :--- | :--- |
| **데이터 수집** | 하드웨어 센서 및 외부 API를 통한 원천 데이터 확보 | 경사도, 장애물 이미지, 공공 시설물 좌표 | 가공 전 원천 데이터(Raw Data) |
| **데이터 처리** | 원시 데이터 정제 및 AI 기반 분석(YOLOv8 등) 수행 | 실시간 ㅣ노면 정보, 제보 사진 | 노력 등급(Effort Level), 정제된 POI 속성 |
| **하이브리드 DB** | 데이터 무결성 관리(MySQL) 및 경로 탐색 최적화(Neo4j) | POI 정보, 경로 연결(Edge) 가중치 정보 | 경로 위상 구조(Topology), 상세 시설 정보 |
| **경로 탐색 엔진** | 가중치 기반 최적 경로(Dijkstra/A*) 산출 | 출발/도착지 POI ID, 사용자 유형 필터 | 최적 경로 좌표 리스트 (JSON) |
| **시각화** | Kakao Maps API를 통한 지도 및 경로 렌더링 | 경로 좌표, POI 마커 정보, 사진 URL | 사용자 화면 내 지도 및 경로 정보 |

--- 
