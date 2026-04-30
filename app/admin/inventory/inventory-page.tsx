"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { FloatItem, formatPeso, useRentalItems } from "@/app/rental-data";

type InventoryFormState = {
  damageFee: string;
  imageUrl: string;
  maxHours: string;
  maxQuantity: string;
  name: string;
  price: string;
};

type FeedbackState = {
  tone: "error" | "success";
  text: string;
};

type EditorState =
  | {
      mode: "create";
      itemId: null;
    }
  | {
      mode: "edit";
      itemId: string;
    }
  | null;

const emptyFormState: InventoryFormState = {
  damageFee: "",
  imageUrl: "",
  maxHours: "1",
  maxQuantity: "1",
  name: "",
  price: "0",
};

export default function InventoryPage() {
  const [items, refreshItems, isLoading] = useRentalItems();
  const [form, setForm] = useState<InventoryFormState>(emptyFormState);
  const [editor, setEditor] = useState<EditorState>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const closeEditor = () => {
    setEditor(null);
    setForm(emptyFormState);
    setIsSubmitting(false);
  };

  const openCreateModal = () => {
    setFeedback(null);
    setForm(emptyFormState);
    setEditor({ itemId: null, mode: "create" });
  };

  const openEditModal = (item: FloatItem) => {
    setFeedback(null);
    setForm({
      damageFee: String(item.damageFee),
      imageUrl: item.imageUrl,
      maxHours: String(item.maxHours),
      maxQuantity: String(item.maxQuantity),
      name: item.name,
      price: String(item.price),
    });
    setEditor({ itemId: item.id, mode: "edit" });
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editor) {
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const payload = {
      ...form,
      damageFee: Number(form.damageFee),
      maxHours: Number(form.maxHours),
      maxQuantity: Number(form.maxQuantity),
      price: Number(form.price),
    };

    const response = await fetch("/api/rental-items", {
      body: JSON.stringify(
        editor.mode === "edit" ? { ...payload, id: editor.itemId } : payload,
      ),
      headers: {
        "Content-Type": "application/json",
      },
      method: editor.mode === "edit" ? "PATCH" : "POST",
    });

    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    if (!response.ok) {
      setIsSubmitting(false);
      setFeedback({
        text: body.message ?? "Unable to save rental item.",
        tone: "error",
      });
      return;
    }

    await refreshItems();
    setFeedback({
      text:
        editor.mode === "edit"
          ? "Rental item updated."
          : "Rental item created successfully.",
      tone: "success",
    });
    closeEditor();
  };

  const deleteItem = async (item: FloatItem) => {
    if (!window.confirm(`Delete ${item.name} from inventory?`)) {
      return;
    }

    setBusyItemId(item.id);
    setFeedback(null);

    const response = await fetch("/api/rental-items", {
      body: JSON.stringify({ id: item.id }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "DELETE",
    });

    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };

    if (!response.ok) {
      setBusyItemId(null);
      setFeedback({
        text: body.message ?? "Unable to delete rental item.",
        tone: "error",
      });
      return;
    }

    await refreshItems();
    setBusyItemId(null);
    setFeedback({
      text: `${item.name} was removed from inventory.`,
      tone: "success",
    });

    if (editor?.mode === "edit" && editor.itemId === item.id) {
      closeEditor();
    }
  };

  return (
    <section className="space-y-5">
      <header className="space-y-3 rounded-md bg-[linear-gradient(180deg,#ff7a45_0%,#ee4d2d_68%,#e64322_100%)] px-5 py-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-normal text-white sm:text-4xl">
              Inventory
            </h1>
            <p className="mt-2 text-base leading-7 text-[#ffe7d6]">
              Manage the rental items shown to customers and staff.
            </p>
          </div>
          <button
            className="h-11 rounded-sm bg-white px-4 text-sm font-bold text-[#ee4d2d] transition hover:bg-[#fff1eb]"
            onClick={openCreateModal}
            type="button"
          >
            Create item
          </button>
        </div>
      </header>

      {feedback && (
        <p
          className={`rounded-sm px-3 py-2 text-sm font-semibold ${
            feedback.tone === "success"
              ? "bg-[color:color-mix(in_srgb,var(--rf-blue)_22%,white)] text-[var(--rf-ink)]"
              : "bg-[color:color-mix(in_srgb,var(--rf-orange)_16%,white)] text-[var(--rf-orange-deep)]"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {isLoading && items.length === 0 ? (
        <section
          aria-label="Loading inventory"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <article
              aria-hidden="true"
              className="overflow-hidden rounded-sm border border-[#ececec] bg-white shadow-sm"
              key={`inventory-skeleton-${index}`}
            >
              <div className="aspect-[4/3] animate-pulse bg-slate-200" />
              <div className="space-y-3 p-4">
                <div className="h-7 w-3/5 animate-pulse rounded bg-slate-200" />
                <div className="h-5 w-2/5 animate-pulse rounded bg-slate-100" />
                <div className="h-14 w-full animate-pulse rounded-lg bg-slate-100" />
              </div>
            </article>
          ))}
        </section>
      ) : items.length === 0 ? (
        <p className="rounded-sm border border-[#ececec] bg-white p-4 text-sm text-slate-600 shadow-sm">
          No rental items are available yet, so there is no inventory to show.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--rf-ink)]/62">
            Showing {items.length} rental item{items.length === 1 ? "" : "s"}.
          </p>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <article
                className="overflow-hidden rounded-sm border border-[#ececec] bg-white shadow-sm"
                key={item.id}
              >
                <div className="relative aspect-[4/3] bg-slate-100">
                  <Image
                    alt={item.name}
                    className="object-cover"
                    fill
                    sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
                    src={item.imageUrl}
                  />
                </div>

                <div className="space-y-3 p-4">
                  <div>
                    <h2 className="text-xl font-bold text-[var(--rf-ink)]">
                      {item.name}
                    </h2>
                  </div>

                  <dl className="space-y-2 rounded-sm border border-[#f2f2f2] bg-[#fafafa] p-3 text-sm">
                    <SimpleRow
                      label="Rental rate"
                      value={`${item.price === 0 ? "Free" : formatPeso(item.price)}${item.price === 0 ? "" : " per hour"}`}
                    />
                    <SimpleRow
                      label="Max hours"
                      value={`${item.maxHours} hour${item.maxHours === 1 ? "" : "s"}`}
                    />
                    <SimpleRow
                      label="Stock"
                      value={`${item.availableQuantity}/${item.maxQuantity}`}
                    />
                    <SimpleRow
                      label="Damage fee"
                      value={formatPeso(item.damageFee)}
                      valueClassName="text-red-700"
                    />
                  </dl>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="h-10 rounded-sm border border-[#e5e5e5] bg-white text-sm font-semibold text-[#444] transition hover:bg-[#fafafa]"
                      onClick={() => openEditModal(item)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="h-10 rounded-sm border border-[#ffcab8] text-sm font-semibold text-[#ee4d2d] transition hover:bg-[#fff5f1] disabled:opacity-50"
                      disabled={busyItemId === item.id}
                      onClick={() => void deleteItem(item)}
                      type="button"
                    >
                      {busyItemId === item.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {editor && (
        <InventoryEditorModal
          form={form}
          isSubmitting={isSubmitting}
          mode={editor.mode}
          onChange={setForm}
          onClose={closeEditor}
          onSubmit={submitForm}
        />
      )}
    </section>
  );
}

function InventoryEditorModal({
  form,
  isSubmitting,
  mode,
  onChange,
  onClose,
  onSubmit,
}: {
  form: InventoryFormState;
  isSubmitting: boolean;
  mode: "create" | "edit";
  onChange: React.Dispatch<React.SetStateAction<InventoryFormState>>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-end bg-[var(--rf-ink)]/45 p-0 sm:place-items-center sm:p-4"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-[#e9e9e9] bg-white p-4 shadow-2xl sm:max-w-2xl sm:rounded-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-[var(--rf-ink)]">
              {mode === "create" ? "Create rental item" : "Edit rental item"}
            </h2>
            <p className="mt-1 text-sm text-[var(--rf-ink)]/72">
              {mode === "create"
                ? "Add a new inventory item for checkout and admin tracking."
                : "Update the existing rental item details."}
            </p>
          </div>
          <button
            className="rounded-sm border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-semibold text-[#555]"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <Field label="Item name">
            <input
              className={inputClassName}
              onChange={(event) =>
                onChange((current) => ({ ...current, name: event.target.value }))
              }
              required
              value={form.name}
            />
          </Field>
          <Field label="Image URL">
            <input
              className={inputClassName}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  imageUrl: event.target.value,
                }))
              }
              placeholder="/rental-items-images/example.png"
              required
              value={form.imageUrl}
            />
          </Field>
          <Field label="Rental rate">
            <input
              className={inputClassName}
              min="0"
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  price: event.target.value,
                }))
              }
              required
              step="1"
              type="number"
              value={form.price}
            />
          </Field>
          <Field label="Damage fee">
            <input
              className={inputClassName}
              min="0"
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  damageFee: event.target.value,
                }))
              }
              required
              step="1"
              type="number"
              value={form.damageFee}
            />
          </Field>
          <Field label="Max hours">
            <input
              className={inputClassName}
              min="1"
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  maxHours: event.target.value,
                }))
              }
              required
              step="1"
              type="number"
              value={form.maxHours}
            />
          </Field>
          <Field label="Stock quantity">
            <input
              className={inputClassName}
              min="1"
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  maxQuantity: event.target.value,
                }))
              }
              required
              step="1"
              type="number"
              value={form.maxQuantity}
            />
          </Field>

          <div className="flex gap-3 md:col-span-2">
            <button
              className="h-12 rounded-sm bg-[#ee4d2d] px-5 text-sm font-bold text-white transition hover:bg-[#d84315] disabled:bg-slate-300"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting
                ? mode === "create"
                  ? "Creating item..."
                  : "Saving changes..."
                : mode === "create"
                  ? "Create item"
                  : "Save changes"}
            </button>
            <button
              className="h-12 rounded-sm border border-[#e5e5e5] px-5 text-sm font-semibold text-[#666]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block text-sm font-semibold text-[var(--rf-ink)]">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function SimpleRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={valueClassName ? valueClassName : "text-slate-500"}>
        {label}
      </dt>
      <dd
        className={`text-right font-semibold ${
          valueClassName ? valueClassName : "text-[var(--rf-ink)]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

const inputClassName =
  "h-11 w-full rounded-sm border border-[#dddddd] bg-white px-3 text-sm outline-none focus:border-[#ee4d2d]";
