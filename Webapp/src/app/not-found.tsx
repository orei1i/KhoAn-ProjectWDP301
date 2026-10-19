import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-semibold text-brand-700">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Không tìm thấy trang</h1>
        <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Về trang chủ</Link>
      </div>
    </main>
  );
}
