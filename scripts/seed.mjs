import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

// Menu IDs from Firestore (seed-famires.mjs 実行後に採番された ID に差し替えること)
const MENUS = {
  hamburg:       { id: "F2zoFM33eWfwECWUG7PN",  name: "和風おろしハンバーグ", price: 980 },
  cheeseHamburg: { id: "INOvuctqwz2Ut7h0mJCH",  name: "チーズハンバーグ",     price: 1080 },
  demiHamburg:   { id: "kYutrrRUh75etMp0lnTj",  name: "デミグラスハンバーグ", price: 1150 },
  carbonara:     { id: "8rvuPjZM4959CMwOz1DQ",  name: "カルボナーラ",         price: 950 },
  bolognese:     { id: "UfB59LNm8KfuWiOx5qn8",  name: "ボロネーゼ",           price: 980 },
  arabbiata:     { id: "RKu84R1GkTffQGGatbEQ",  name: "アラビアータ",         price: 920 },
  margherita:    { id: "0nnYYWsNmpX1z4i9D5bh",  name: "マルゲリータ",         price: 1200 },
  cheesePizza:   { id: "CSrdmcSQTObvQHmal5i8",  name: "4種のチーズピザ",     price: 1380 },
  pepperoni:     { id: "LJoEr5KWxRbfTnIPugck",  name: "ペパロニピザ",         price: 1280 },
  riceAdd:       { id: "0s3HQqw08SX7stV7g6sJ",  name: "ライス追加",           price: 165 },
  breadAdd:      { id: "5hBjrrPXK8ZpkXxs4QdB",  name: "パン追加",             price: 165 },
  fries:         { id: "6X0SqER3O3NVMgY6Sn53",  name: "フライドポテト",       price: 220 },
  onionRing:     { id: "SU2O7fGiZyiEXBeYOMnb",  name: "オニオンリング",       price: 220 },
  cornSoup:      { id: "XszUjVsqeCr5yytL4xKa",  name: "コーンスープ",         price: 220 },
  miniSalad:     { id: "e6kjLsFg4tqVDluV0XrE",  name: "ミニサラダ",           price: 165 },
  caesarSalad:   { id: "fm1oR7ZTtfYjfF2CKsna",  name: "シーザーサラダ",       price: 580 },
  iceCream:      { id: "jMtXqBeAmal9I2xzAatX",  name: "バニラアイス",         price: 380 },
  cola:          { id: "f2Ayn4ItsEuS8dFWrI5r",  name: "コーラ",               price: 280 },
  oolong:        { id: "8AJnF0LNLTS7KDaQs5KS",  name: "アイスティー",         price: 280 },
  oj:            { id: "0xdO4mZ7lXLyT4dVoVQN",  name: "オレンジジュース",     price: 280 },
  iceCoffee:     { id: "ZhsoWOOoBde8BJ0vbfZm",  name: "アイスコーヒー",       price: 320 },
  hotCoffee:     { id: "mE2iYIuQgDHmapOWRR3v",  name: "ホットコーヒー",       price: 320 },
};

function item(menu, qty, sides = [], note = "", checked = false) {
  return { menuId: menu.id, name: menu.name, price: menu.price, quantity: qty, sides, note, checked };
}

function side(menu, qty = 1) {
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
    customer: { offset: -88, isPaid: true }, // 11:32
    table: "3", guests: 2,
    orders: [
      {
        status: "completed", offset: -88,
        items: [
          item(MENUS.hamburg, 1, [side(MENUS.fries)]),
          item(MENUS.carbonara, 1),
          item(MENUS.cola, 2),
        ],
      },
    ],
  },
  {
    customer: { offset: -55, isPaid: true }, // 12:05
    table: "7", guests: 4,
    orders: [
      {
        status: "completed", offset: -55,
        items: [
          item(MENUS.cheeseHamburg, 2, [side(MENUS.riceAdd)]),
          item(MENUS.margherita, 1),
          item(MENUS.carbonara, 1),
          item(MENUS.caesarSalad, 1),
          item(MENUS.cola, 2),
          item(MENUS.oj, 2),
        ],
      },
      {
        status: "completed", offset: -30, // 追加注文 12:30
        items: [
          item(MENUS.iceCream, 2),
          item(MENUS.hotCoffee, 2),
        ],
      },
    ],
  },
  {
    customer: { offset: -12, isPaid: false }, // 12:48
    table: "1", guests: 1,
    orders: [
      {
        status: "pending", offset: -12,
        items: [
          item(MENUS.demiHamburg, 1, [side(MENUS.riceAdd)]),
          item(MENUS.oolong, 1),
        ],
      },
    ],
  },
  {
    customer: { offset: -39, isPaid: false }, // 12:21
    table: "5", guests: 3,
    orders: [
      {
        status: "completed", offset: -39,
        items: [
          item(MENUS.hamburg, 1, [], "", true),
          item(MENUS.bolognese, 1, [], "", true),
          item(MENUS.cheesePizza, 1, [], "", true),
          item(MENUS.miniSalad, 2, [], "", true),
          item(MENUS.cola, 2, [], "", true),
          item(MENUS.iceCoffee, 1, [], "", true),
        ],
      },
    ],
  },
  {
    customer: { offset: -65, isPaid: true }, // 11:55
    table: "9", guests: 2,
    orders: [
      {
        status: "completed", offset: -65,
        items: [
          item(MENUS.margherita, 1),
          item(MENUS.carbonara, 1),
          item(MENUS.caesarSalad, 1),
          item(MENUS.cola, 1),
          item(MENUS.oj, 1),
        ],
      },
    ],
  },
  {
    customer: { offset: -2, isPaid: false }, // 13:02 (最近入店)
    table: "2", guests: 2,
    orders: [
      {
        status: "pending", offset: -2,
        items: [
          item(MENUS.cheeseHamburg, 1, [side(MENUS.fries)]),
          item(MENUS.pepperoni, 1),
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
    const isPaid = s.customer.isPaid === true;
    await customerRef.set({
      customerId: customerRef.id,
      tableId: s.table,
      guestCount: s.guests,
      isPaid,
      createdAt: customerCreated,
      updatedAt: fsTs(Math.max(...s.orders.map((o) => o.offset))),
    });
    console.log(`Customer ${customerRef.id} (table ${s.table})`);

    for (const o of s.orders) {
      const orderRef = customerRef.collection("orders").doc();
      const orderCreated = fsTs(o.offset);
      await orderRef.set({
        orderId: orderRef.id,
        customerId: customerRef.id,
        status: o.status,
        createdAt: orderCreated,
        updatedAt: orderCreated,
      });
      console.log(`  Order ${orderRef.id} (${o.status})`);

      for (const it of o.items) {
        const mainItemRef = orderRef.collection("items").doc();
        await mainItemRef.set({
          itemId: mainItemRef.id,
          orderId: orderRef.id,
          customerId: customerRef.id,
          menuId: it.menuId,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          setId: mainItemRef.id,
          note: it.note,
          checked: it.checked,
          createdAt: orderCreated,
          updatedAt: orderCreated,
        });
        for (const s of it.sides) {
          const sideRef = orderRef.collection("items").doc();
          await sideRef.set({
            itemId: sideRef.id,
            orderId: orderRef.id,
            customerId: customerRef.id,
            menuId: s.menuId,
            name: s.name,
            price: s.price,
            quantity: s.quantity,
            setId: mainItemRef.id,
            note: "",
            checked: it.checked,
            createdAt: orderCreated,
            updatedAt: orderCreated,
          });
        }
      }
      console.log(`    ${o.items.length} items`);
    }
  }
  console.log("Done.");
}

seed().catch(console.error);
