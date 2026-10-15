import { cn } from '../../lib/cn'

/**
 * One data table that is honest on a phone: a real <table> on md+, and
 * stacked labeled cards below — instead of forcing a 760px horizontal scroll.
 *
 * columns: [{ key, header, render?(row, index), align?, className?, primary? }]
 * rowKey: string | ((row, index) => string)
 */
export function DataTable({ columns, rows, rowKey, className, empty, onRowClick, caption }) {
  const cols = columns || []
  const data = rows || []
  const keyOf = typeof rowKey === 'function' ? rowKey : (row, index) => (rowKey ? row[rowKey] : index)

  if (!data.length) {
    return empty ? <div className={className}>{empty}</div> : null
  }

  return (
    <div className={className}>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--border)] md:block">
        <table className="w-full border-collapse text-left text-[var(--fs-body)]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--fs-caption)] uppercase tracking-wide text-[var(--text-subtle)]">
              {cols.map((col) => (
                <th key={col.key} scope="col" className={cn('px-4 py-3 font-semibold', col.align === 'right' && 'text-right', col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr
                key={keyOf(row, index)}
                onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                className={cn('border-b border-[var(--border-subtle)] last:border-0', onRowClick && 'cursor-pointer hover:bg-[var(--surface-hover)]')}
              >
                {cols.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 align-middle text-[var(--text)]', col.align === 'right' && 'text-right', col.className)}>
                    {col.render ? col.render(row, index) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone */}
      <ul className="space-y-2 md:hidden">
        {data.map((row, index) => (
          <li
            key={keyOf(row, index)}
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            className={cn('rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-4', onRowClick && 'cursor-pointer active:bg-[var(--surface-hover)]')}
          >
            {cols.map((col) => (
              <div key={col.key} className={cn('flex items-center justify-between gap-3 py-0.5', col.primary && 'mb-1')}>
                <span className={cn('shrink-0 text-[var(--fs-caption)] uppercase tracking-wide text-[var(--text-subtle)]', col.primary && 'sr-only')}>
                  {col.header}
                </span>
                <span className={cn('min-w-0 text-[var(--fs-body)] text-[var(--text)]', col.primary && 'w-full text-[var(--fs-h3)] font-semibold text-[var(--text-strong)]', col.align === 'right' && 'text-right')}>
                  {col.render ? col.render(row, index) : row[col.key]}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
