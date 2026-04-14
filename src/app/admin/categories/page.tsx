"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Category } from "@/types";

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newOrder, setNewOrder] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setCategories(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Category, "id">) }))
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      await addDoc(collection(db, "categories"), {
        name: newName.trim(),
        sortOrder: Math.trunc(Number(newOrder)) || 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewName("");
      setNewOrder(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました。");
    }
  }

  async function handleUpdate(id: string, data: Partial<Category>) {
    setError(null);
    try {
      await updateDoc(doc(db, "categories", id), {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    // 参照中のメニューがないかチェック
    const menusQ = query(
      collection(db, "menus"),
      where("categoryIds", "array-contains", id)
    );
    const referenced = await getDocs(menusQ);
    if (!referenced.empty) {
      setError(
        `このカテゴリは ${referenced.size} 件のメニューから参照されているため削除できません。`
      );
      return;
    }
    if (!confirm("このカテゴリを削除しますか？")) return;
    try {
      await deleteDoc(doc(db, "categories", id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-bold">カテゴリ管理</h1>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <form
        onSubmit={handleAdd}
        className="mb-6 flex flex-wrap items-end gap-2 rounded border border-gray-200 p-4"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs text-gray-600">名前</label>
          <input
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例: 丼もの"
          />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs text-gray-600">並び順</label>
          <input
            type="number"
            step={1}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            value={newOrder}
            onChange={(e) => setNewOrder(Math.trunc(Number(e.target.value)) || 0)}
          />
        </div>
        <button
          type="submit"
          className="rounded bg-gray-800 px-4 py-2 text-sm text-white"
        >
          追加
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-500">読み込み中...</p>
      ) : categories.length === 0 ? (
        <p className="text-sm text-gray-500">カテゴリがまだありません。</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="p-2 w-24">並び順</th>
              <th className="p-2">名前</th>
              <th className="p-2 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <CategoryRow
                key={c.id}
                category={c}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  onUpdate,
  onDelete,
}: {
  category: Category;
  onUpdate: (id: string, data: Partial<Category>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [sortOrder, setSortOrder] = useState(category.sortOrder);

  useEffect(() => {
    setName(category.name);
    setSortOrder(category.sortOrder);
  }, [category]);

  const dirty = name !== category.name || sortOrder !== category.sortOrder;

  return (
    <tr className="border-b border-gray-100">
      <td className="p-2">
        <input
          type="number"
          step={1}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          value={sortOrder}
          onChange={(e) => setSortOrder(Math.trunc(Number(e.target.value)) || 0)}
        />
      </td>
      <td className="p-2">
        <input
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td className="p-2">
        <div className="flex gap-1">
          <button
            disabled={!dirty}
            onClick={() => onUpdate(category.id, { name, sortOrder })}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-white disabled:opacity-30"
          >
            保存
          </button>
          <button
            onClick={() => onDelete(category.id)}
            className="rounded bg-red-600 px-2 py-1 text-xs text-white"
          >
            削除
          </button>
        </div>
      </td>
    </tr>
  );
}
