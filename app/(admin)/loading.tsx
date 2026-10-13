// Shown the instant you click another page while the server prepares it.
// Without it the old page just sat there until the new one was ready, which
// read as the admin being slow.
export default function AdminLoading() {
  return (
    <div className="p-6 md:p-8 max-w-6xl animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded-lg bg-gray-200 mb-2" />
      <div className="h-4 w-72 rounded bg-gray-100 mb-8" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-[#e2e8d5] bg-white" />
        ))}
      </div>
      <div className="rounded-xl border border-[#e2e8d5] bg-white p-5 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 rounded bg-gray-100" style={{ width: `${90 - i * 8}%` }} />
        ))}
      </div>
    </div>
  )
}
