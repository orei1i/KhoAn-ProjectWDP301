import type { NextConfig } from 'next';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const nextConfig: NextConfig = {
  transpilePackages: ['@ssm/shared'],

  /**
   * Phục vụ trang xử lý đăng nhập của Firebase ngay trên domain của app.
   *
   * Mặc định Firebase đặt nó ở <project>.firebaseapp.com. Chrome/Safari nay phân vùng storage theo
   * origin, nên sau signInWithRedirect, SDK quay về domain app KHÔNG đọc được kết quả nằm ở origin
   * firebaseapp.com → getRedirectResult() trả null, người dùng rơi lại trang login mà không có lỗi.
   *
   * Proxy /__/auth/* về Firebase làm trang xử lý trở thành same-origin với app → redirect chạy đúng.
   * Đi kèm: NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN phải đổi thành domain của app.
   */
  /**
   * Header bảo mật cơ bản. Cố ý KHÔNG đặt CSP đầy đủ (script-src...) — dễ làm vỡ Next (script inline khi hydrate) và Firebase Auth.
   * Chống nhúng trang vào iframe (clickjacking) áp cho mọi trang TRỪ /__/* : Firebase Auth nhúng /__/auth/iframe (proxy ở dưới)
   * vào chính trang app — chặn nó thì đăng nhập Google hỏng.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/((?!__/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },

  async rewrites() {
    if (!projectId) return [];
    const upstream = `https://${projectId}.firebaseapp.com`;
    return [
      { source: '/__/auth/:path*', destination: `${upstream}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `${upstream}/__/firebase/:path*` },
    ];
  },
};

export default nextConfig;
