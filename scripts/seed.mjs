import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "fs";

// Use application default credentials
initializeApp({ projectId: "gonmura-food" });
const db = getFirestore();

const now = new Date("2026-04-20T12:00:00+09:00");
const ts = (offsetMin = 0) => {
  const d = new Date(now.getTime() + offsetMin * 60000);
  return { toDate: () => d, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, _seconds: Math.floor(d.getTime() / 1000) };
};
const fsTs = (offsetMin = 0) => {
  const d = new Date(now.getTime() + offsetMin * 60000);
  return d;
};

// Menu IDs from Firestore
const MENUS = {
  ramen:         { id: "F2zoFM33eWfwECWUG7PN",  name: "ラーメン",         price: 900 },
  ajitamaRamen:  { id: "INOvuctqwz2Ut7h0mJCH",  name: "味玉ラーメン",     price: 980 },
  chashuRamen:   { id: "kYutrrRUh75etMp0lnTj",  name: "チャーシューラーメン", price: 1200 },
  yasuiRamen:    { id: "8rvuPjZM4959CMwOz1DQ",  name: "野菜ラーメン",     price: 950 },
  ninniku:       { id: "UfB59LNm8KfuWiOx5qn8",  name: "にんにくラーメン", price: 950 },
  gekikara:      { id: "RKu84R1GkTffQGGatbEQ",  name: "激辛ラーメン",     price: 1050 },
  karamiso:      { id: "0nnYYWsNmpX1z4i9D5bh",  name: "辛味噌ラーメン",   price: 1000 },
  toriPaiTan:    { id: "CSrdmcSQTObvQHmal5i8",  name: "鶏白湯ラーメン",   price: 950 },
  toriShio:      { id: "LJoEr5KWxRbfTnIPugck",  name: "鶏白湯塩ラーメン", price: 1000 },
  noukouTori:    { id: "BPrS25LoUsZWAHSiSBw1",  name: "濃厚鶏白湯ラーメン", price: 1100 },
  ajitama:       { id: "1l82tbhksuOgEduBvx6O",  name: "味玉",             price: 150 },
  nori:          { id: "6N32LzNt5m9zBVbHInRI",  name: "海苔増し(5枚)",   price: 150 },
  chashu:        { id: "Skj5cujaYOOT4wlSVzOK",  name: "チャーシュー増し", price: 250 },
  moyashi:       { id: "ZqBYIDrLQ4iGBEwqaoeV",  name: "もやし",           price: 100 },
  halfRice:      { id: "0s3HQqw08SX7stV7g6sJ",  name: "半ライス",         price: 150 },
  rice:          { id: "5hBjrrPXK8ZpkXxs4QdB",  name: "ライス",           price: 200 },
  agegyoza:      { id: "6X0SqER3O3NVMgY6Sn53",  name: "揚げ餃子(5個)",   price: 480 },
  miniChashuDon: { id: "SU2O7fGiZyiEXBeYOMnb",  name: "ミニチャーシュー丼", price: 400 },
  chahan:        { id: "XszUjVsqeCr5yytL4xKa",  name: "チャーハン",       price: 450 },
  gyoza:         { id: "e6kjLsFg4tqVDluV0XrE",  name: "餃子(5個)",       price: 500 },
  harumaki:      { id: "fm1oR7ZTtfYjfF2CKsna",  name: "春巻き(3本)",     price: 450 },
  karaage:       { id: "jMtXqBeAmal9I2xzAatX",  name: "唐揚げ(3個)",     price: 400 },
  beer:          { id: "6BVtPDoInnCl1bUjfdmw",  name: "瓶ビール",         price: 600 },
  oolong:        { id: "8AJnF0LNLTS7KDaQs5KS",  name: "烏龍茶",           price: 200 },
  cola:          { id: "f2Ayn4ItsEuS8dFWrI5r",  name: "コーラ",           price: 200 },
  lemonSour:     { id: "mE2iYIuQgDHmapOWRR3v",  name: "レモンサワー",     price: 500 },
  calpis:        { id: "ZhsoWOOoBde8BJ0vbfZm",  name: "カルピス",         price: 200 },
  oj:            { id: "0xdO4mZ7lXLyT4dVoVQN",  name: "オレンジジュース", price: 200 },
};

function item(menu, qty, toppings = [], note = "", checked = false) {
  return { menuId: menu.id, name: menu.name, price: menu.price, quantity: qty, toppings, note, checked };
}

function topping(menu, qty = 1) {
  return { menuId: menu.id, name: menu.name, price: menu.price, quantity: qty };
}

// ---- シナリオ設計 ----
// テーブル3, 2名 → 精算済み (lunch 11:32)
// テーブル7, 4名 → 精算済み (lunch 12:05、追加注文あり)
// テーブル1, 1名 → pending (現在食事中 12:48)
// テーブル5, 3名 → completed (提供済み・未精算 12:21)
// テーブル9, 2名 → 精算済み (lunch 11:55)
// テーブル2, 2名 → pending (現在食事中 13:02)

const scenarios = [
  {
    customer: { offset: -88 }, // 11:32
    table: "3", guests: 2,
    orders: [
      {
        status: "paid", offset: -88,
        items: [
          item(MENUS.ramen, 1, [topping(MENUS.chashu)]),
          item(MENUS.ramen, 1, [topping(MENUS.ajitama), topping(MENUS.nori)]),
          item(MENUS.halfRice, 2),
          item(MENUS.beer, 1),
        ],
      },
    ],
  },
  {
    customer: { offset: -55 }, // 12:05
    table: "7", guests: 4,
    orders: [
      {
        status: "paid", offset: -55,
        items: [
          item(MENUS.chashuRamen, 2),
          item(MENUS.ajitamaRamen, 1, [topping(MENUS.nori)]),
          item(MENUS.ramen, 1),
          item(MENUS.gyoza, 1),
          item(MENUS.beer, 2),
          item(MENUS.cola, 2),
        ],
      },
      {
        status: "paid", offset: -30, // 追加注文 12:30
        items: [
          item(MENUS.beer, 2),
          item(MENUS.karaage, 1),
          item(MENUS.chahan, 1),
        ],
      },
    ],
  },
  {
    customer: { offset: -12 }, // 12:48
    table: "1", guests: 1,
    orders: [
      {
        status: "pending", offset: -12,
        items: [
          item(MENUS.ninniku, 1, [topping(MENUS.moyashi), topping(MENUS.chashu)], "脂多めで"),
          item(MENUS.halfRice, 1),
          item(MENUS.oolong, 1),
        ],
      },
    ],
  },
  {
    customer: { offset: -39 }, // 12:21
    table: "5", guests: 3,
    orders: [
      {
        status: "completed", offset: -39,
        items: [
          item(MENUS.gekikara, 1, [], "", true),
          item(MENUS.yasuiRamen, 1, [topping(MENUS.ajitama)], "", true),
          item(MENUS.chashuRamen, 1, [], "", true),
          item(MENUS.chahan, 1, [], "", true),
          item(MENUS.cola, 2, [], "", true),
          item(MENUS.calpis, 1, [], "", true),
        ],
      },
    ],
  },
  {
    customer: { offset: -65 }, // 11:55
    table: "9", guests: 2,
    orders: [
      {
        status: "paid", offset: -65,
        items: [
          item(MENUS.toriPaiTan, 1, [topping(MENUS.nori)]),
          item(MENUS.karamiso, 1),
          item(MENUS.miniChashuDon, 1),
          item(MENUS.lemonSour, 2),
        ],
      },
    ],
  },
  {
    customer: { offset: -2 }, // 13:02 (最近入店)
    table: "2", guests: 2,
    orders: [
      {
        status: "pending", offset: -2,
        items: [
          item(MENUS.noukouTori, 1, [topping(MENUS.ajitama), topping(MENUS.chashu)]),
          item(MENUS.toriShio, 1, [topping(MENUS.nori)]),
          item(MENUS.agegyoza, 1),
          item(MENUS.cola, 1),
          item(MENUS.oj, 1),
        ],
      },
    ],
  },
];

async function seed() {
  for (const s of scenarios) {
    const customerRef = db.collection("customers").doc();
    const customerCreated = fsTs(s.customer.offset);
    await customerRef.set({
      createdAt: customerCreated,
      updatedAt: customerCreated,
    });
    console.log(`Customer ${customerRef.id} (table ${s.table})`);

    for (const o of s.orders) {
      const orderRef = customerRef.collection("orders").doc();
      const orderCreated = fsTs(o.offset);
      await orderRef.set({
        status: o.status,
        tableNumber: s.table,
        guestCount: s.guests,
        createdAt: orderCreated,
        updatedAt: orderCreated,
      });
      console.log(`  Order ${orderRef.id} (${o.status})`);

      for (const it of o.items) {
        const itemRef = orderRef.collection("items").doc();
        await itemRef.set({
          menuId: it.menuId,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          toppings: it.toppings,
          note: it.note,
          checked: it.checked,
          createdAt: orderCreated,
          updatedAt: orderCreated,
        });
      }
      console.log(`    ${o.items.length} items`);
    }
  }
  console.log("Done.");
}

seed().catch(console.error);
