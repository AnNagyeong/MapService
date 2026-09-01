# 휠체어 진입 제보 API

AccessNavWep에서 사용자 제보를 MapService로 보내고, 관리자 승인 후 확정된 장소 접근성 정보를 다시 조회하기 위한 API입니다.

## 제보 등록

`POST /api/accessibility-reports`

```json
{
  "placeName": "뉴성민병원",
  "address": "인천 ...",
  "x": 126.0,
  "y": 37.0,
  "type": "기타",
  "wheelchairAccess": "accessible",
  "detail": "입구 경사로 확인",
  "imageData": "data:image/jpeg;base64,..."
}
```

`wheelchairAccess` 값:

- `unknown`: 휠체어 진입 정보 확인 필요
- `accessible`: 휠체어 진입 가능
- `not_accessible`: 휠체어 진입 어려움

## 관리자 제보 목록

`GET /api/accessibility-reports?status=PENDING`

## 관리자 승인/반려

`POST /api/accessibility-reports/:id/approve`

`POST /api/accessibility-reports/:id/reject`

승인하면 `place_accessibility` 테이블에 확정된 장소 접근성 정보가 반영됩니다.

## 장소 접근성 조회

`GET /api/place-accessibility?name=뉴성민병원&address=인천...&lat=37.0&lng=126.0`

```json
{
  "ok": true,
  "status": "accessible",
  "label": "휠체어 진입 가능",
  "verified": true
}
```
