import { DatePicker } from "@/components/admin/DatePicker";

type Props = {
  dateValue: string;
  onDateChange: (v: string) => void;
  maxDate: string;
  tableFilter: string | null;
  onTableFilterChange: (v: string | null) => void;
  availableTables: string[];
  filteredCount: number;
  totalCount: number;
  totalAmount: number;
  totalAmountExTax?: number;
};

export function OrderHistoryFilterBar({
  dateValue,
  onDateChange,
  maxDate,
  tableFilter,
  onTableFilterChange,
  availableTables,
  filteredCount,
  totalCount,
  totalAmount,
  totalAmountExTax,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <DatePicker value={dateValue} onChange={onDateChange} max={maxDate} />
      <button
        type="button"
        onClick={() => onDateChange(maxDate)}
        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
          dateValue !== maxDate
            ? "border-[color:var(--color-accent-char)] bg-[color:var(--color-accent-char)] text-white"
            : "border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-subtle)]"
        }`}
      >
        今日
      </button>
      {availableTables.length > 0 && (
        <select
          value={tableFilter ?? ""}
          onChange={(e) => onTableFilterChange(e.target.value === "" ? null : e.target.value)}
          className="bg-[color:var(--color-bg-card)] border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm text-[color:var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-char)]"
        >
          <option value="">全テーブル</option>
          {availableTables.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      <span className="text-xs text-[color:var(--color-text-muted)]">
        {filteredCount}件
        {tableFilter !== null && ` / 全${totalCount}件`}
        {" "}/ ¥{totalAmount.toLocaleString()}{totalAmountExTax !== undefined && `（税抜¥${totalAmountExTax.toLocaleString()}）`}
      </span>
    </div>
  );
}
