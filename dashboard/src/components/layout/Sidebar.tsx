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
            <Link href="/wallets/So11111111111111111111111111111111111111112" className="block py-1 hover:text-blue-600 truncate">
              So11...1112 (Example)
            </Link>
            <Link href="/wallets/ARKSVsdjpZk9c422e13a732269e8f49799a69f275c" className="block py-1 hover:text-blue-600 truncate">
              ARKS...75c (Example)
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