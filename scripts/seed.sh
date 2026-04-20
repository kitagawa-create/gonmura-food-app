#!/bin/bash
set -e

PROJECT="gonmura-food"
BASE="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents"
TOKEN=$(gcloud auth print-access-token)

post() {
  local path="$1"
  local body="$2"
  curl -s -X POST "$BASE/$path" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); n=d.get('name','ERROR'); print(n.split('/')[-1] if 'name' in d else json.dumps(d))"
}

patch() {
  local name="$1"
  local body="$2"
  curl -s -X PATCH "$BASE/$name" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" > /dev/null
}

ts() {
  # offset in minutes from "2026-04-20T12:00:00+09:00"
  local offset=${1:-0}
  python3 -c "
from datetime import datetime, timezone, timedelta
base = datetime(2026, 4, 20, 3, 0, 0, tzinfo=timezone.utc)  # 12:00 JST = 03:00 UTC
t = base + timedelta(minutes=$offset)
print(t.strftime('%Y-%m-%dT%H:%M:%SZ'))
"
}

make_customer() {
  local created="$1"
  local body=$(python3 -c "
import json
print(json.dumps({'fields': {
  'createdAt': {'timestampValue': '$created'},
  'updatedAt': {'timestampValue': '$created'}
}}))
")
  post "customers" "$body"
}

make_order() {
  local cid="$1" status="$2" table="$3" guests="$4" created="$5"
  local body=$(python3 -c "
import json
print(json.dumps({'fields': {
  'status': {'stringValue': '$status'},
  'tableNumber': {'stringValue': '$table'},
  'guestCount': {'integerValue': '$guests'},
  'createdAt': {'timestampValue': '$created'},
  'updatedAt': {'timestampValue': '$created'}
}}))
")
  post "customers/$cid/orders" "$body"
}

make_item() {
  local cid="$1" oid="$2"
  local menuId="$3" name="$4" price="$5" qty="$6" note="$7" checked="$8"
  shift 8
  # remaining args: topping_menuId topping_name topping_price topping_qty ...
  local toppings_json="[]"
  if [ $# -gt 0 ]; then
    toppings_json=$(python3 -c "
import json, sys
args = sys.argv[1:]
toppings = []
for i in range(0, len(args), 4):
    toppings.append({'mapValue': {'fields': {
        'menuId': {'stringValue': args[i]},
        'name': {'stringValue': args[i+1]},
        'price': {'integerValue': args[i+2]},
        'quantity': {'integerValue': args[i+3]}
    }}})
print(json.dumps({'values': toppings}))
" "$@")
  fi

  local body=$(python3 -c "
import json
toppings_arr = $toppings_json if '$toppings_json' != '[]' else {'values': []}
print(json.dumps({'fields': {
  'menuId': {'stringValue': '$menuId'},
  'name': {'stringValue': '$name'},
  'price': {'integerValue': '$price'},
  'quantity': {'integerValue': '$qty'},
  'toppings': {'arrayValue': toppings_arr if isinstance(toppings_arr, dict) else {'values': []}},
  'note': {'stringValue': '$note'},
  'checked': {'booleanValue': $([ '$checked' = 'true' ] && echo 'true' || echo 'false')}
}}))
")
  post "customers/$cid/orders/$oid/items" "$body" > /dev/null
}

echo "=== Seeding Firestore ==="

# ---- Table 3, 2名, paid (11:32) ----
echo "Table 3 (paid)..."
T=$(ts -88); CID=$(make_customer "$T"); echo "  customer: $CID"
OID=$(make_order "$CID" "paid" "3" "2" "$T"); echo "  order: $OID"
# ラーメン x1 + チャーシュー増し
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"F2zoFM33eWfwECWUG7PN"},"name":{"stringValue":"ラーメン"},"price":{"integerValue":"900"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"Skj5cujaYOOT4wlSVzOK"},"name":{"stringValue":"チャーシュー増し"},"price":{"integerValue":"250"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
# ラーメン x1 + 味玉 + 海苔増し
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"F2zoFM33eWfwECWUG7PN"},"name":{"stringValue":"ラーメン"},"price":{"integerValue":"900"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"1l82tbhksuOgEduBvx6O"},"name":{"stringValue":"味玉"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}},{"mapValue":{"fields":{"menuId":{"stringValue":"6N32LzNt5m9zBVbHInRI"},"name":{"stringValue":"海苔増し(5枚)"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":"固め"},"checked":{"booleanValue":false}}}' > /dev/null
# 半ライス x2
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"0s3HQqw08SX7stV7g6sJ"},"name":{"stringValue":"半ライス"},"price":{"integerValue":"150"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
# 瓶ビール x1
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"6BVtPDoInnCl1bUjfdmw"},"name":{"stringValue":"瓶ビール"},"price":{"integerValue":"600"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
echo "  items: 4"

# ---- Table 7, 4名, paid x2 (12:05 + 12:30) ----
echo "Table 7 (paid x2)..."
T1=$(ts -55); T2=$(ts -30)
CID=$(make_customer "$T1"); echo "  customer: $CID"
OID=$(make_order "$CID" "paid" "7" "4" "$T1"); echo "  order1: $OID"
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"kYutrrRUh75etMp0lnTj"},"name":{"stringValue":"チャーシューラーメン"},"price":{"integerValue":"1200"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"INOvuctqwz2Ut7h0mJCH"},"name":{"stringValue":"味玉ラーメン"},"price":{"integerValue":"980"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"6N32LzNt5m9zBVbHInRI"},"name":{"stringValue":"海苔増し(5枚)"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"F2zoFM33eWfwECWUG7PN"},"name":{"stringValue":"ラーメン"},"price":{"integerValue":"900"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":"薄め"},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"e6kjLsFg4tqVDluV0XrE"},"name":{"stringValue":"餃子(5個)"},"price":{"integerValue":"500"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"6BVtPDoInnCl1bUjfdmw"},"name":{"stringValue":"瓶ビール"},"price":{"integerValue":"600"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"f2Ayn4ItsEuS8dFWrI5r"},"name":{"stringValue":"コーラ"},"price":{"integerValue":"200"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
echo "  order1 items: 6"
# 追加注文
OID2=$(make_order "$CID" "paid" "7" "4" "$T2"); echo "  order2: $OID2"
curl -s -X POST "$BASE/customers/$CID/orders/$OID2/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"6BVtPDoInnCl1bUjfdmw"},"name":{"stringValue":"瓶ビール"},"price":{"integerValue":"600"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID2/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"jMtXqBeAmal9I2xzAatX"},"name":{"stringValue":"唐揚げ(3個)"},"price":{"integerValue":"400"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID2/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"XszUjVsqeCr5yytL4xKa"},"name":{"stringValue":"チャーハン"},"price":{"integerValue":"450"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
echo "  order2 items: 3"

# ---- Table 1, 1名, pending (12:48) ----
echo "Table 1 (pending)..."
T=$(ts -12); CID=$(make_customer "$T"); echo "  customer: $CID"
OID=$(make_order "$CID" "pending" "1" "1" "$T"); echo "  order: $OID"
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"UfB59LNm8KfuWiOx5qn8"},"name":{"stringValue":"にんにくラーメン"},"price":{"integerValue":"950"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"ZqBYIDrLQ4iGBEwqaoeV"},"name":{"stringValue":"もやし"},"price":{"integerValue":"100"},"quantity":{"integerValue":"1"}}}},{"mapValue":{"fields":{"menuId":{"stringValue":"Skj5cujaYOOT4wlSVzOK"},"name":{"stringValue":"チャーシュー増し"},"price":{"integerValue":"250"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":"脂多めで"},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"0s3HQqw08SX7stV7g6sJ"},"name":{"stringValue":"半ライス"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"8AJnF0LNLTS7KDaQs5KS"},"name":{"stringValue":"烏龍茶"},"price":{"integerValue":"200"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
echo "  items: 3"

# ---- Table 5, 3名, completed (12:21) ----
echo "Table 5 (completed)..."
T=$(ts -39); CID=$(make_customer "$T"); echo "  customer: $CID"
OID=$(make_order "$CID" "completed" "5" "3" "$T"); echo "  order: $OID"
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"RKu84R1GkTffQGGatbEQ"},"name":{"stringValue":"激辛ラーメン"},"price":{"integerValue":"1050"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":true}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"8rvuPjZM4959CMwOz1DQ"},"name":{"stringValue":"野菜ラーメン"},"price":{"integerValue":"950"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"1l82tbhksuOgEduBvx6O"},"name":{"stringValue":"味玉"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":""},"checked":{"booleanValue":true}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"kYutrrRUh75etMp0lnTj"},"name":{"stringValue":"チャーシューラーメン"},"price":{"integerValue":"1200"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":true}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"XszUjVsqeCr5yytL4xKa"},"name":{"stringValue":"チャーハン"},"price":{"integerValue":"450"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":true}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"f2Ayn4ItsEuS8dFWrI5r"},"name":{"stringValue":"コーラ"},"price":{"integerValue":"200"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":true}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"ZhsoWOOoBde8BJ0vbfZm"},"name":{"stringValue":"カルピス"},"price":{"integerValue":"200"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":true}}}' > /dev/null
echo "  items: 6"

# ---- Table 9, 2名, paid (11:55) ----
echo "Table 9 (paid)..."
T=$(ts -65); CID=$(make_customer "$T"); echo "  customer: $CID"
OID=$(make_order "$CID" "paid" "9" "2" "$T"); echo "  order: $OID"
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"CSrdmcSQTObvQHmal5i8"},"name":{"stringValue":"鶏白湯ラーメン"},"price":{"integerValue":"950"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"6N32LzNt5m9zBVbHInRI"},"name":{"stringValue":"海苔増し(5枚)"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"0nnYYWsNmpX1z4i9D5bh"},"name":{"stringValue":"辛味噌ラーメン"},"price":{"integerValue":"1000"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"SU2O7fGiZyiEXBeYOMnb"},"name":{"stringValue":"ミニチャーシュー丼"},"price":{"integerValue":"400"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"mE2iYIuQgDHmapOWRR3v"},"name":{"stringValue":"レモンサワー"},"price":{"integerValue":"500"},"quantity":{"integerValue":"2"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
echo "  items: 4"

# ---- Table 2, 2名, pending (13:02) ----
echo "Table 2 (pending)..."
T=$(ts -2); CID=$(make_customer "$T"); echo "  customer: $CID"
OID=$(make_order "$CID" "pending" "2" "2" "$T"); echo "  order: $OID"
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"BPrS25LoUsZWAHSiSBw1"},"name":{"stringValue":"濃厚鶏白湯ラーメン"},"price":{"integerValue":"1100"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"1l82tbhksuOgEduBvx6O"},"name":{"stringValue":"味玉"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}},{"mapValue":{"fields":{"menuId":{"stringValue":"Skj5cujaYOOT4wlSVzOK"},"name":{"stringValue":"チャーシュー増し"},"price":{"integerValue":"250"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"LJoEr5KWxRbfTnIPugck"},"name":{"stringValue":"鶏白湯塩ラーメン"},"price":{"integerValue":"1000"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[{"mapValue":{"fields":{"menuId":{"stringValue":"6N32LzNt5m9zBVbHInRI"},"name":{"stringValue":"海苔増し(5枚)"},"price":{"integerValue":"150"},"quantity":{"integerValue":"1"}}}}]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"6X0SqER3O3NVMgY6Sn53"},"name":{"stringValue":"揚げ餃子(5個)"},"price":{"integerValue":"480"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"f2Ayn4ItsEuS8dFWrI5r"},"name":{"stringValue":"コーラ"},"price":{"integerValue":"200"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
curl -s -X POST "$BASE/customers/$CID/orders/$OID/items" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fields":{"menuId":{"stringValue":"0xdO4mZ7lXLyT4dVoVQN"},"name":{"stringValue":"オレンジジュース"},"price":{"integerValue":"200"},"quantity":{"integerValue":"1"},"toppings":{"arrayValue":{"values":[]}},"note":{"stringValue":""},"checked":{"booleanValue":false}}}' > /dev/null
echo "  items: 5"

echo ""
echo "=== Done! ==="
