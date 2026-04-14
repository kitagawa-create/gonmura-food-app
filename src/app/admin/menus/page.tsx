"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import type { Category, Menu } from "@/types";

type MenuFormData = {
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  categoryIds: string[];
  isAvailable: boolean;
};

const EMPTY_FORM: MenuFormData = {
  name: "",
  description: "",
  price: 0,
  imageUrl: "",
  categoryIds: [],
  isAvailable: true,
};

export default function AdminMenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Menu | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubMenus = onSnapshot(
      query(collection(db, "menus"), orderBy("name", "asc")),
      (snap) =>
        setMenus(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Menu, "id">) }))
        )
    );
    const unsubCats = onSnapshot(
      query(collection(db, "categories"), orderBy("sortOrder", "asc")),
      (snap) => {
        setCategories(
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Category, "id">),
          }))
        );
        setLoading(false);
      }
    );
    return () => {
      unsubMenus();
      unsubCats();
    };
  }, []);

  const categoryMap = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  async function handleSave(data: MenuFormData, imageFile: File | null, id?: string) {
    setError(null);
    try {
      let imageUrl = data.imageUrl;
      if (imageFile) {
        const fileRef = ref(storage, `menus/${Date.now()}_${imageFile.name}`);
        await uploadBytes(fileRef, imageFile);
        imageUrl = await getDownloadURL(fileRef);
      }
      const saveData = {
        ...data,
        imageUrl,
        price: Math.trunc(Number(data.price)) || 0,
      };
      if (id) {
        await updateDoc(doc(db, "menus", id), {
          ...saveData,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "menus"), {
          ...saveData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
    }
  }

  async function handleToggleAvailable(menu: Menu) {
    try {
      await updateDoc(doc(db, "menus", menu.id), {
        isAvailable: !menu.isAvailable,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました。");
    }
  }

  async function handleDelete(menu: Menu) {
    if (!confirm(`「${menu.name}」を削除しますか？`)) return;
    try {
      await deleteDoc(doc(db, "menus", menu.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">メニュー管理</h1>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="rounded bg-gray-800 px-4 py-2 text-sm text-white"
        >
          新規追加
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">読み込み中...</p>
      ) : menus.length === 0 ? (
        <p className="text-sm text-gray-500">メニューがまだありません。</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {menus.map((m) => (
            <div
              key={m.id}
              className={`rounded border border-gray-200 p-4 ${
                m.isAvailable ? "" : "bg-gray-100 opacity-60"
              }`}
            >
              <div className="flex gap-3">
                {m.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.imageUrl}
                    alt={m.name}
                    className="h-20 w-20 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{m.name}</h2>
                  <p className="text-sm text-gray-700">¥{m.price}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {m.categoryIds
                      .map((id) => categoryMap.get(id)?.name ?? "(不明)")
                      .join(", ") || "(カテゴリ未設定)"}
                  </p>
                  {m.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                      {m.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setEditing(m);
                    setShowForm(true);
                  }}
                  className="rounded border border-gray-300 px-3 py-1 text-xs"
                >
                  編集
                </button>
                <button
                  onClick={() => handleToggleAvailable(m)}
                  className="rounded border border-gray-300 px-3 py-1 text-xs"
                >
                  {m.isAvailable ? "非公開にする" : "公開する"}
                </button>
                <button
                  onClick={() => handleDelete(m)}
                  className="rounded bg-red-600 px-3 py-1 text-xs text-white"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <MenuFormModal
          menu={editing}
          categories={categories}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function MenuFormModal({
  menu,
  categories,
  onClose,
  onSave,
}: {
  menu: Menu | null;
  categories: Category[];
  onClose: () => void;
  onSave: (data: MenuFormData, imageFile: File | null, id?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<MenuFormData>(
    menu
      ? {
          name: menu.name,
          description: menu.description,
          price: menu.price,
          imageUrl: menu.imageUrl,
          categoryIds: menu.categoryIds,
          isAvailable: menu.isAvailable,
        }
      : EMPTY_FORM
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(menu?.imageUrl || null);
  const [saving, setSaving] = useState(false);

  function toggleCategory(id: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id],
    }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) {
      setPreview(URL.createObjectURL(file));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave(form, imageFile, menu?.id);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded bg-white p-6"
      >
        <h2 className="mb-4 text-lg font-bold">
          {menu ? "メニュー編集" : "メニュー追加"}
        </h2>

        <div className="space-y-3">
          <Field label="名前">
            <input
              required
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="説明">
            <textarea
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          <Field label="価格（税込・円）">
            <input
              type="number"
              min={0}
              step={1}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={form.price}
              onChange={(e) =>
                setForm({ ...form, price: Math.trunc(Number(e.target.value)) || 0 })
              }
            />
          </Field>
          <Field label="画像">
            {preview && (
              <img
                src={preview}
                alt="プレビュー"
                className="mb-2 h-32 w-32 rounded object-cover"
              />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-gray-200"
            />
          </Field>
          <Field label="カテゴリ（複数選択可）">
            <div className="flex flex-wrap gap-2">
              {categories.length === 0 ? (
                <p className="text-xs text-gray-500">
                  カテゴリがまだありません。
                </p>
              ) : (
                categories.map((c) => {
                  const checked = form.categoryIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`cursor-pointer rounded border px-3 py-1 text-xs ${
                        checked
                          ? "border-gray-800 bg-gray-800 text-white"
                          : "border-gray-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleCategory(c.id)}
                      />
                      {c.name}
                    </label>
                  );
                })
              )}
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isAvailable}
              onChange={(e) =>
                setForm({ ...form, isAvailable: e.target.checked })
              }
            />
            公開する
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-4 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-gray-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-600">{label}</label>
      {children}
    </div>
  );
}
