import Link from 'next/link';

export default function Sidebar() {
  return (
    <aside className="w-64 h-screen p-4 border-r bg-gray-50 dark:bg-gray-800">
      <nav>
        <ul>
          <li className="mb-2">
            <Link href="/" className="text-lg font-semibold hover:text-blue-600">
              Dashboard Home
            </Link>
          </li>
          <li className="mb-2">
            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Wallets</p>
            {/* Placeholder for wallet list/selection */}
            <Link href="/wallets/DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm" className="block py-1 hover:text-blue-600 truncate">
            Gake
            </Link>
            <Link href="/wallets/EaVboaPxFCYanjoNWdkxTbPvt57nhXGu5i6m9m6ZS2kK" className="block py-1 hover:text-blue-600 truncate">
            EaVb...S2kK (real-loaded)
            </Link>
            <Link href="/wallets/empty-wallet" className="block py-1 hover:text-blue-600 truncate">
              Empty Wallet (Test)
            </Link>
             <Link href="/wallets/error-wallet" className="block py-1 hover:text-blue-600 truncate">
              Error Wallet (Test)
            </Link>
          </li>
          <li className="mb-2">
            <Link href="/settings" className="block py-1 hover:text-blue-600">
              Settings
            </Link>
          </li>
          <li className="mb-2">
            <Link href="/help" className="block py-1 hover:text-blue-600">
              Help/Documentation
            </Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
} 