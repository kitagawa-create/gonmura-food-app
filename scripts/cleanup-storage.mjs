import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

if (!getApps().length) {
  initializeApp({
    projectId: "gonmura-food",
    storageBucket: "gonmura-food.firebasestorage.app",
  });
}

const KEEP = new Set([
  "menus/0nnYYWsNmpX1z4i9D5bh.jpg",
  "menus/0s3HQqw08SX7stV7g6sJ.jpg",
  "menus/0xdO4mZ7lXLyT4dVoVQN.jpg",
  "menus/1l82tbhksuOgEduBvx6O.jpg",
  "menus/5hBjrrPXK8ZpkXxs4QdB.jpg",
  "menus/6BVtPDoInnCl1bUjfdmw.jpg",
  "menus/6N32LzNt5m9zBVbHInRI.jpg",
  "menus/6X0SqER3O3NVMgY6Sn53.jpg",
  "menus/8AJnF0LNLTS7KDaQs5KS.jpg",
  "menus/8rvuPjZM4959CMwOz1DQ.jpg",
  "menus/02zqBdnGtzAzkGrqrO4e.jpg",
  "menus/BPrS25LoUsZWAHSiSBw1.jpg",
  "menus/CSrdmcSQTObvQHmal5i8.jpg",
  "menus/F2zoFM33eWfwECWUG7PN.jpg",
  "menus/INOvuctqwz2Ut7h0mJCH.jpg",
  "menus/L8ayA1uIPTXPd76qVwQQ.jpg",
  "menus/LJoEr5KWxRbfTnIPugck.jpg",
  "menus/RKu84R1GkTffQGGatbEQ.jpg",
  "menus/SU2O7fGiZyiEXBeYOMnb.jpg",
  "menus/Skj5cujaYOOT4wlSVzOK.jpg",
  "menus/UfB59LNm8KfuWiOx5qn8.jpg",
  "menus/XszUjVsqeCr5yytL4xKa.jpg",
  "menus/ZhsoWOOoBde8BJ0vbfZm.jpg",
  "menus/ZqBYIDrLQ4iGBEwqaoeV.jpg",
  "menus/e6kjLsFg4tqVDluV0XrE.jpg",
  "menus/f2Ayn4ItsEuS8dFWrI5r.jpg",
  "menus/fm1oR7ZTtfYjfF2CKsna.jpg",
  "menus/jMtXqBeAmal9I2xzAatX.jpg",
  "menus/kYutrrRUh75etMp0lnTj.jpg",
  "menus/koY0hUl1hJbMjydT22TP.jpg",
  "menus/mE2iYIuQgDHmapOWRR3v.jpg",
  "menus/mdpR6UkQ9yFYuuri28e7.jpg",
  "menus/nnXYRzzLVuMqkJOend7Q.jpg",
  "menus/paVoBuX86Twy7u164Qmo.jpg",
  "menus/qZ6SpgKdZshrAq7J2r10.jpg",
  "menus/tnlUhG8LCec1L77RVMms.jpg",
  "menus/vd6CVU0BhSE2cQu8Vaop.jpg",
]);

const bucket = getStorage().bucket();
const [files] = await bucket.getFiles({ prefix: "menus/" });

console.log(`Storage内ファイル数: ${files.length}`);
let deleted = 0;
for (const file of files) {
  if (!KEEP.has(file.name)) {
    await file.delete();
    console.log(`削除: ${file.name}`);
    deleted++;
  }
}
console.log(`完了: ${deleted}件削除、${files.length - deleted}件保持`);
