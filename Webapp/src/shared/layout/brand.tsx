import Link from 'next/link';

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 10.5 12 4l9 6.5V20H3z" />
          <path d="M7 20v-6h10v6M7 17h10" />
        </svg>
      </span>
      <span className={`text-base font-bold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>
        Kho<span className="text-brand-500">An</span>
      </span>
    </Link>
  );
}
