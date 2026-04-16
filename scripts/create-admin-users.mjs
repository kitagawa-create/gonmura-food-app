// 管理者ユーザー (Firebase Auth + admins/{uid} doc) を一括作成
// 使い方:
//   gcloud auth login 済みの状態で
//   node scripts/create-admin-users.mjs
import { execSync } from "node:child_process";

const API_KEY = "AIzaSyCqqm5aYTw7HjkkfbIDFPVAL7im3CNWYfQ";
const PROJECT_ID = "gonmura-food";

const USERS = [
  { email: "owner@gonmura.com", password: "aaaaaa", role: "owner" },
  { email: "staff@gonmura.com", password: "aaaaaa", role: "staff" },
];

const accessToken = execSync("gcloud auth print-access-token").toString().trim();

async function ensureAuthUser(email, password) {
  // signUp (新規)。既存なら lookup で uid を取る。
  const signupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    }
  );
  if (signupRes.ok) {
    const j = await signupRes.json();
    console.log(`✔ created ${email} → ${j.localId}`);
    return j.localId;
  }
  const err = await signupRes.json();
  if (err.error?.message === "EMAIL_EXISTS") {
    // signIn で uid を取得（同じパスワード前提）
    const signin = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      }
    );
    const j = await signin.json();
    if (!j.localId) {
      throw new Error(`signIn failed for ${email}: ${JSON.stringify(j)}`);
    }
    console.log(`= existed ${email} → ${j.localId}`);
    return j.localId;
  }
  throw new Error(`signUp failed for ${email}: ${JSON.stringify(err)}`);
}

async function writeAdminDoc(uid, email, role) {
  const now = new Date().toISOString();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/${uid}?updateMask.fieldPaths=email&updateMask.fieldPaths=role&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=createdAt`;
  const body = {
    fields: {
      email: { stringValue: email },
      role: { stringValue: role },
      createdAt: { timestampValue: now },
      updatedAt: { timestampValue: now },
    },
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`firestore write failed for ${uid}: ${await res.text()}`);
  }
  console.log(`✔ admins/${uid} role=${role}`);
}

for (const u of USERS) {
  const uid = await ensureAuthUser(u.email, u.password);
  await writeAdminDoc(uid, u.email, u.role);
}
console.log("done.");
