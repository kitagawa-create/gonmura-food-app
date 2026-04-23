#!/usr/bin/env python3
"""1年分のサンプルデータをFirestoreに投入する。"""
import random, json, subprocess, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

JST = timezone(timedelta(hours=9))
UTC = timezone.utc
PROJECT = "gonmura-food"
BASE = f"projects/{PROJECT}/databases/(default)/documents"
URL = f"https://firestore.googleapis.com/v1/{BASE}:batchWrite"

random.seed(42)

# ---- メニューデータ (id, name, price, weight) ----
RAMEN = [
    ("F2zoFM33eWfwECWUG7PN", "ラーメン",           900,  32),
    ("INOvuctqwz2Ut7h0mJCH", "味玉ラーメン",       980,  22),
    ("kYutrrRUh75etMp0lnTj", "チャーシューラーメン",1200, 14),
    ("8rvuPjZM4959CMwOz1DQ", "野菜ラーメン",        950,  9),
    ("UfB59LNm8KfuWiOx5qn8", "にんにくラーメン",    950,  8),
    ("RKu84R1GkTffQGGatbEQ", "激辛ラーメン",       1050,  5),
    ("0nnYYWsNmpX1z4i9D5bh", "辛味噌ラーメン",     1000,  6),
    ("CSrdmcSQTObvQHmal5i8", "鶏白湯ラーメン",      950,  8),
    ("LJoEr5KWxRbfTnIPugck", "鶏白湯塩ラーメン",   1000,  5),
    ("BPrS25LoUsZWAHSiSBw1", "濃厚鶏白湯ラーメン", 1100,  4),
]

TOPPINGS = [
    ("1l82tbhksuOgEduBvx6O", "味玉",           150, 40),
    ("6N32LzNt5m9zBVbHInRI", "海苔増し(5枚)",  150, 25),
    ("Skj5cujaYOOT4wlSVzOK", "チャーシュー増し",250, 30),
    ("ZqBYIDrLQ4iGBEwqaoeV", "もやし",         100, 20),
]

SIDES = [
    ("0s3HQqw08SX7stV7g6sJ", "半ライス",         150, 35),
    ("5hBjrrPXK8ZpkXxs4QdB", "ライス",           200, 18),
    ("e6kjLsFg4tqVDluV0XrE", "餃子(5個)",        500, 14),
    ("6X0SqER3O3NVMgY6Sn53", "揚げ餃子(5個)",    480, 10),
    ("jMtXqBeAmal9I2xzAatX", "唐揚げ(3個)",      400, 10),
    ("XszUjVsqeCr5yytL4xKa", "チャーハン",        450,  7),
    ("SU2O7fGiZyiEXBeYOMnb", "ミニチャーシュー丼",400,  9),
    ("fm1oR7ZTtfYjfF2CKsna", "春巻き(3本)",      450,  5),
]

DRINKS_SOFT = [
    ("f2Ayn4ItsEuS8dFWrI5r", "コーラ",           200, 30),
    ("8AJnF0LNLTS7KDaQs5KS", "烏龍茶",           200, 25),
    ("ZhsoWOOoBde8BJ0vbfZm", "カルピス",          200, 15),
    ("0xdO4mZ7lXLyT4dVoVQN", "オレンジジュース",  200, 10),
]

DRINKS_ALC = [
    ("6BVtPDoInnCl1bUjfdmw", "瓶ビール",          600, 55),
    ("mE2iYIuQgDHmapOWRR3v", "レモンサワー",       500, 45),
]

# ---- ユーティリティ ----
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

def new_id():
    return "".join(random.choices(CHARS, k=20))

def wc(items):
    """重み付きランダム選択 (id, name, price, weight) → (id, name, price)"""
    total = sum(x[3] for x in items)
    r = random.uniform(0, total)
    cum = 0
    for x in items:
        cum += x[3]
        if r <= cum:
            return x[:3]
    return items[-1][:3]

# ---- Firestoreの値型 ----
def sv(s): return {"stringValue": s}
def iv(n): return {"integerValue": str(int(n))}
def bv(b): return {"booleanValue": bool(b)}
def tv(dt): return {"timestampValue": dt.strftime("%Y-%m-%dT%H:%M:%SZ")}
def av(vals): return {"arrayValue": {"values": list(vals)}}
def mv(fields): return {"mapValue": {"fields": fields}}

# ---- 注文生成 ----
def gen_items(guests: int, is_dinner: bool) -> list:
    items = []

    for _ in range(guests):
        rid, rname, rprice = wc(RAMEN)
        main_id = new_id()
        if random.random() < 0.42:
            n = random.choices([1, 2], weights=[72, 28])[0]
            chosen = random.sample(TOPPINGS, min(n, len(TOPPINGS)))
            for t in chosen:
                items.append({
                    "itemId": new_id(), "menuId": t[0], "name": t[1], "price": t[2],
                    "quantity": 1, "setId": main_id, "note": "", "checked": False,
                })
        items.append({
            "itemId": main_id, "menuId": rid, "name": rname, "price": rprice,
            "quantity": 1, "setId": main_id, "note": "", "checked": False,
        })

    # ライス (30%)
    if random.random() < 0.30:
        sid, sname, sprice = wc(SIDES[:2])
        item_id = new_id()
        items.append({"itemId": item_id, "menuId": sid, "name": sname, "price": sprice, "quantity": 1, "setId": item_id, "note": "", "checked": False})

    # サイド (20%)
    if random.random() < 0.20:
        sid, sname, sprice = wc(SIDES[2:])
        item_id = new_id()
        items.append({"itemId": item_id, "menuId": sid, "name": sname, "price": sprice, "quantity": 1, "setId": item_id, "note": "", "checked": False})

    # ドリンク (ゲスト数 × 45%)
    for _ in range(guests):
        if random.random() < 0.45:
            if is_dinner and random.random() < 0.38:
                did, dname, dprice = wc(DRINKS_ALC)
            else:
                did, dname, dprice = wc(DRINKS_SOFT)
            item_id = new_id()
            items.append({"itemId": item_id, "menuId": did, "name": dname, "price": dprice, "quantity": 1, "setId": item_id, "note": "", "checked": False})

    return items

def gen_order_time(date: datetime, session: str) -> datetime:
    if session == "lunch":
        h = random.randint(11, 13)
        m = random.randint(0 if h > 11 else 30, 59)
    else:
        h = random.randint(17, 20)
        m = random.randint(30 if h == 17 else 0, 59)
    return datetime(date.year, date.month, date.day, h, m, random.randint(0, 59), tzinfo=JST).astimezone(UTC)

def build_writes(dt: datetime, table: str, guests: int) -> list:
    cid, oid = new_id(), new_id()
    is_dinner = dt.hour >= 8  # UTC 8 = JST 17
    items = gen_items(guests, is_dinner)
    ts = tv(dt)

    writes = [
        {"update": {"name": f"{BASE}/customers/{cid}", "fields": {
            "customerId": sv(cid), "tableId": sv(table), "guestCount": iv(guests),
            "isPaid": bv(True), "createdAt": ts, "updatedAt": ts,
        }}},
        {"update": {"name": f"{BASE}/customers/{cid}/orders/{oid}", "fields": {
            "orderId": sv(oid), "customerId": sv(cid), "status": sv("completed"),
            "createdAt": ts, "updatedAt": ts,
        }}},
    ]
    for item in items:
        writes.append({"update": {"name": f"{BASE}/customers/{cid}/orders/{oid}/items/{item['itemId']}", "fields": {
            "itemId": sv(item["itemId"]), "orderId": sv(oid), "customerId": sv(cid),
            "menuId": sv(item["menuId"]), "name": sv(item["name"]),
            "price": iv(item["price"]), "quantity": iv(item["quantity"]),
            "setId": sv(item["setId"]),
            "note": sv(item["note"]), "checked": bv(item["checked"]),
        }}})
    return writes

# ---- メイン ----
def main():
    token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    start = datetime(2025, 4, 20, tzinfo=JST)
    end   = datetime(2026, 4, 19, tzinfo=JST)

    all_writes = []
    total_orders = 0
    d = start
    while d <= end:
        # 月曜定休
        if d.weekday() == 0:
            d += timedelta(days=1)
            continue

        is_weekend = d.weekday() in (5, 6)
        lunch_n  = random.randint(10, 22) if is_weekend else random.randint(6, 16)
        dinner_n = random.randint(12, 28) if is_weekend else random.randint(6, 20)

        for session, count in [("lunch", lunch_n), ("dinner", dinner_n)]:
            for _ in range(count):
                table  = str(random.randint(1, 10))
                guests = random.choices([1, 2, 3, 4], weights=[22, 42, 22, 14])[0]
                dt     = gen_order_time(d, session)
                all_writes.extend(build_writes(dt, table, guests))
                total_orders += 1

        d += timedelta(days=1)

    print(f"注文数: {total_orders:,}  書き込み数: {len(all_writes):,}")

    # 500件ずつbatchWrite
    BATCH = 500
    batches = [all_writes[i:i+BATCH] for i in range(0, len(all_writes), BATCH)]
    print(f"バッチ数: {len(batches)}")

    for i, batch in enumerate(batches):
        body = json.dumps({"writes": batch}).encode()
        req  = urllib.request.Request(URL, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                if "writeResults" not in data:
                    print(f"  batch {i+1} ERROR: {data}")
        except urllib.error.HTTPError as e:
            print(f"  batch {i+1} HTTP {e.code}: {e.read()[:200]}")
        if (i + 1) % 10 == 0:
            print(f"  {i+1}/{len(batches)} 完了...")

    print("Done!")

if __name__ == "__main__":
    main()
