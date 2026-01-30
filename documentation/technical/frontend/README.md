# 🎨 Frontend Dashboard - Deep Dive

## 🎯 Overview

The Frontend Dashboard is a **Next.js 14** application built with **TypeScript** and **Tailwind CSS** that provides an intuitive, responsive interface for the Wallet Analysis System. It features real-time data visualization, interactive charts, and a modern component-based architecture that makes complex blockchain data accessible and actionable.

## 📚 Important Documentation

**⚠️ CRITICAL:** Before developing, read these guides to avoid common pitfalls:

- **[Cache Management Guide](./CACHE_MANAGEMENT.md)** - ⚠️ **REQUIRED READING** - Understanding SWR cache behavior, limitations, and solutions. Read this to avoid spending hours debugging cache issues.

## 📖 Quick Links

- [Cache Troubleshooting](./CACHE_MANAGEMENT.md#troubleshooting-guide)
- [Cache Invalidation Patterns](./CACHE_MANAGEMENT.md#cache-invalidation-patterns)
- [Common Pitfalls](./CACHE_MANAGEMENT.md#common-pitfalls)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND DASHBOARD                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │   App Router    │  │   Components    │  │     Hooks       │  │
│  │                 │  │                 │  │                 │  │
│  │ • Page Routes   │  │ • UI Components │  │ • Custom Hooks  │  │
│  │ • Layout        │  │ • Charts        │  │ • State Mgmt    │  │
│  │ • Middleware    │  │ • Forms         │  │ • API Calls     │  │
│  │ • Error        │  │ • Navigation    │  │ • WebSocket     │  │
│  │   Handling      │  │ • Modals        │  │   Integration   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │     Store       │  │     Utils       │  │   Types         │  │
│  │                 │  │                 │  │                 │  │
│  │ • State Mgmt    │  │ • Helpers       │  │ • TypeScript    │  │
│  │ • Persistence   │  │ • Formatters    │  │   Interfaces    │  │
│  │ • Caching       │  │ • Validation    │  │ • API Types     │  │
│  │ • Sync          │  │ • Calculations  │  │ • Component     │  │
│  └─────────────────┘  └─────────────────┘  │   Props         │  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Directory Structure

```
dashboard/
├── src/
│   ├── app/                     # Next.js 14 App Router
│   │   ├── globals.css          # Global styles
│   │   ├── layout.tsx           # Root layout
│   │   ├── page.tsx             # Home page
│   │   ├── error.tsx            # Error boundary
│   │   ├── help/                # Help documentation
│   │   │   └── page.tsx         # Help page
│   │   ├── settings/            # User settings
│   │   │   └── page.tsx         # Settings page
│   │   ├── similarity-lab/      # Similarity analysis lab
│   │   │   └── page.tsx         # Similarity lab page
│   │   └── wallets/             # Wallet analysis pages
│   │       └── [walletAddress]/ # Dynamic wallet routes
│   │           └── page.tsx     # Individual wallet page
│   ├── components/               # Reusable UI components
│   │   ├── charts/              # Data visualization
│   │   │   └── EChartComponent.tsx # ECharts integration
│   │   ├── dashboard/           # Dashboard-specific components
│   │   │   ├── AccountStatsPnlTab.tsx # P&L statistics tab
│   │   │   ├── AccountSummaryCard.tsx # Wallet summary card
│   │   │   ├── BehavioralPatternsTab.tsx # Behavior analysis tab
│   │   │   ├── GlobalMetricsCard.tsx # Global metrics display
│   │   │   ├── KeyInsightsCard.tsx # Key insights display
│   │   │   ├── PerformanceMetricsTab.tsx # Performance metrics
│   │   │   ├── PortfolioOverviewTab.tsx # Portfolio overview
│   │   │   ├── SimilarityResultsTab.tsx # Similarity results
│   │   │   ├── TokenHoldingsTab.tsx # Token holdings display
│   │   │   └── TradingHistoryTab.tsx # Trading history
│   │   ├── layout/              # Layout components
│   │   │   ├── LayoutClientShell.tsx # Main layout shell
│   │   │   ├── LazyTabContent.tsx # Lazy-loaded tab content
│   │   │   ├── QuickAddForm.tsx # Quick wallet addition
│   │   │   ├── Sidebar.tsx      # Main sidebar navigation
│   │   │   ├── TabNavigation.tsx # Tab navigation system
│   │   │   └── TopBar.tsx       # Top navigation bar
│   │   ├── shared/              # Shared/common components
│   │   │   ├── EmptyState.tsx   # Empty state display
│   │   │   ├── TimeRangeSelector.tsx # Time range picker
│   │   │   ├── TokenBadge.tsx   # Token display badges
│   │   │   ├── LoadingSpinner.tsx # Loading indicators
│   │   │   └── ErrorBoundary.tsx # Error handling
│   │   ├── sidebar/             # Sidebar components
│   │   │   ├── FavoriteWalletItem.tsx # Favorite wallet display
│   │   │   ├── FavoriteWalletsList.tsx # Favorites list
│   │   │   └── WalletSearch.tsx # Wallet search component
│   │   ├── similarity-lab/      # Similarity lab components
│   │   │   ├── results/         # Similarity results
│   │   │   │   ├── ContextualHoldingsCard.tsx # Holdings context
│   │   │   │   ├── EnhancedKeyInsights.tsx # Enhanced insights
│   │   │   │   ├── GlobalMetricsCard.tsx # Global metrics
│   │   │   │   ├── KeyInsightsCard.tsx # Key insights
│   │   │   │   ├── SimilarityMatrixCard.tsx # Similarity matrix
│   │   │   │   ├── SimilarityResultsCard.tsx # Results display
│   │   │   │   ├── TopSimilarWalletsCard.tsx # Top similar wallets
│   │   │   │   └── WalletComparisonCard.tsx # Wallet comparison
│   │   │   ├── WalletInputForm.tsx # Wallet input form
│   │   │   └── WalletSelector.tsx # Wallet selection
│   │   ├── ui/                  # Base UI components (shadcn/ui)
│   │   │   ├── accordion.tsx    # Collapsible sections
│   │   │   ├── alert-dialog.tsx # Alert dialogs
│   │   │   ├── alert.tsx        # Alert notifications
│   │   │   ├── badge.tsx        # Status badges
│   │   │   ├── button.tsx       # Button components
│   │   │   ├── card.tsx         # Card containers
│   │   │   ├── dialog.tsx       # Modal dialogs
│   │   │   ├── dropdown-menu.tsx # Dropdown menus
│   │   │   ├── form.tsx         # Form components
│   │   │   ├── input.tsx        # Input fields
│   │   │   ├── label.tsx        # Form labels
│   │   │   ├── popover.tsx      # Popover components
│   │   │   ├── select.tsx       # Select dropdowns
│   │   │   ├── separator.tsx    # Visual separators
│   │   │   ├── sheet.tsx        # Slide-out panels
│   │   │   ├── skeleton.tsx     # Loading skeletons
│   │   │   ├── table.tsx        # Data tables
│   │   │   ├── tabs.tsx         # Tab components
│   │   │   ├── textarea.tsx     # Text area inputs
│   │   │   ├── toast.tsx        # Toast notifications
│   │   │   └── tooltip.tsx      # Tooltip components
│   │   ├── theme-provider.tsx   # Theme management
│   │   └── theme-toggle-button.tsx # Theme toggle
│   ├── hooks/                    # Custom React hooks
│   │   ├── use-toast.ts         # Toast notifications
│   │   ├── useFavorites.ts      # Favorites management
│   │   └── useJobProgress.ts    # Job progress tracking
│   ├── lib/                      # Utility libraries
│   │   ├── cache-provider.ts    # Caching utilities
│   │   ├── changelog.ts         # Change log data
│   │   ├── color-utils.ts       # Color manipulation
│   │   ├── constants.ts         # Application constants
│   │   ├── formatters.ts        # Data formatting
│   │   ├── validators.ts        # Input validation
│   │   └── websocket.ts         # WebSocket utilities
│   ├── store/                    # State management
│   │   ├── api-key-store.ts     # API key storage
│   │   └── time-range-store.ts  # Time range state
│   └── types/                    # TypeScript type definitions
│       ├── api.ts               # API response types
│       ├── websockets.ts        # WebSocket types
│       └── lodash.d.ts          # Lodash type extensions
├── public/                       # Static assets
│   ├── file.svg                 # File icon
│   ├── globe.svg                # Globe icon
│   ├── next.svg                 # Next.js logo
│   ├── preview/                 # Preview images
│   │   └── dashboard-preview.png # Dashboard preview
│   ├── vercel.svg               # Vercel logo
│   └── window.svg               # Window icon
├── components.json               # shadcn/ui configuration
├── tailwind.config.ts           # Tailwind CSS configuration
├── tsconfig.json                # TypeScript configuration
├── next.config.ts               # Next.js configuration
├── package.json                 # Dependencies and scripts
└── README.md                    # Project documentation
```

## 🎨 **UI Component System**

### **Design System Foundation**
The dashboard uses **shadcn/ui** as its component foundation, providing:
- **Consistent Design**: Unified visual language across all components
- **Accessibility**: WCAG-compliant components with proper ARIA labels
- **Customization**: Easy theming and customization through CSS variables
- **Performance**: Optimized components with minimal bundle impact

### **Component Categories**

#### **1. Base UI Components** (`src/components/ui/`)
```typescript
// Example: Button component with variants
<Button variant="default" size="lg" onClick={handleClick}>
  Analyze Wallet
</Button>

<Button variant="destructive" size="sm">
  Delete Analysis
</Button>

<Button variant="outline" size="icon">
  <Settings className="h-4 w-4" />
</Button>
```

#### **2. Dashboard Components** (`src/components/dashboard/`)
Specialized components for wallet analysis display:

```typescript
// Account Summary Card
<AccountSummaryCard
  walletAddress="wallet_address"
  totalValue={1234.56}
  change24h={+5.67}
  changePercent={+0.46}
  lastUpdated={new Date()}
/>

// Behavioral Patterns Tab
<BehavioralPatternsTab
  behaviorData={behaviorMetrics}
  timeRange="30d"
  onTimeRangeChange={handleTimeRangeChange}
/>
```

#### **3. Chart Components** (`src/components/charts/`)
Data visualization using **ECharts**:

```typescript
// ECharts integration for complex data visualization
<EChartComponent
  option={chartOption}
  style={{ height: '400px' }}
  onChartClick={handleChartClick}
  loading={isLoading}
/>
```

## 🚀 **Page Architecture**

### **App Router Structure**
The dashboard uses Next.js 14 App Router for modern routing:

```typescript
// Root layout with theme provider and navigation
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LayoutClientShell>
            {children}
          </LayoutClientShell>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### **Dynamic Routes**
```typescript
// Dynamic wallet analysis page
// app/wallets/[walletAddress]/page.tsx
export default function WalletPage({
  params,
}: {
  params: { walletAddress: string }
}) {
  const { walletAddress } = params;
  
  return (
    <div className="container mx-auto p-6">
      <WalletAnalysis walletAddress={walletAddress} />
    </div>
  );
}
```

### **Page Components**

#### **1. Home Page** (`app/page.tsx`)
- **Wallet Search**: Quick wallet lookup
- **Recent Analysis**: Recently analyzed wallets
- **Quick Stats**: System overview statistics
- **Getting Started**: Onboarding for new users

#### **2. Wallet Analysis Page** (`app/wallets/[walletAddress]/page.tsx`)
- **Wallet Overview**: Summary and key metrics
- **Tab Navigation**: Organized analysis sections
- **Real-time Updates**: Live data refresh
- **Export Options**: Data export capabilities

#### **3. Similarity Lab** (`app/similarity-lab/page.tsx`)
- **Multi-wallet Input**: Compare multiple wallets
- **Similarity Matrix**: Visual similarity display
- **Clustering Analysis**: Group similar wallets
- **Export Results**: Download analysis reports

## 🔧 **State Management**

### **Store Architecture**
The dashboard uses a combination of React hooks and Zustand for state management:

```typescript
// API Key Store (Zustand)
interface ApiKeyStore {
  apiKey: string | null;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  isValid: boolean;
}

export const useApiKeyStore = create<ApiKeyStore>((set, get) => ({
  apiKey: null,
  setApiKey: (key) => set({ apiKey: key, isValid: true }),
  clearApiKey: () => set({ apiKey: null, isValid: false }),
  isValid: false,
}));

// Time Range Store (Zustand)
interface TimeRangeStore {
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  customRange: CustomTimeRange | null;
  setCustomRange: (range: CustomTimeRange | null) => void;
}
```

### **Custom Hooks**

#### **1. useFavorites** (`hooks/useFavorites.ts`)
```typescript
export function useFavorites() {
  const [favorites, setFavorites] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const addFavorite = useCallback(async (walletAddress: string) => {
    // Add wallet to favorites
  }, []);
  
  const removeFavorite = useCallback(async (walletAddress: string) => {
    // Remove wallet from favorites
  }, []);
  
  return {
    favorites,
    isLoading,
    addFavorite,
    removeFavorite,
  };
}
```

#### **2. useJobProgress** (`hooks/useJobProgress.ts`)
```typescript
export function useJobProgress(jobId: string | null) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  useEffect(() => {
    if (!jobId) return;
    
    // WebSocket connection for real-time progress
    const socket = new WebSocket(`ws://localhost:3001/jobs/${jobId}`);
    
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setProgress(data);
    };
    
    return () => socket.close();
  }, [jobId]);
  
  return { progress, isConnected };
}
```

## 🌐 **API Integration**

### **API Client Pattern**
```typescript
// Centralized API client with error handling
class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  
  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText);
    }
    
    return response.json();
  }
  
  async analyzeWallet(walletAddress: string): Promise<AnalysisResult> {
    return this.request<AnalysisResult>(
      `/analyses/wallets/${walletAddress}/trigger-analysis`,
      { method: 'POST' }
    );
  }
  
  async getWalletOverview(walletAddress: string): Promise<WalletOverview> {
    return this.request<WalletOverview>(`/wallets/${walletAddress}/overview`);
  }
}
```

### **Data Fetching Patterns**
```typescript
// React Query for server state management
export function useWalletOverview(walletAddress: string) {
  return useQuery({
    queryKey: ['wallet', walletAddress, 'overview'],
    queryFn: () => apiClient.getWalletOverview(walletAddress),
    enabled: !!walletAddress,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // 30 seconds
  });
}

// Mutations for data updates
export function useTriggerAnalysis() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (walletAddress: string) => 
      apiClient.analyzeWallet(walletAddress),
    onSuccess: (data, walletAddress) => {
      // Invalidate and refetch related queries
      queryClient.invalidateQueries({
        queryKey: ['wallet', walletAddress],
      });
    },
  });
}
```

## 📊 **Data Visualization**

### **Chart Integration**
The dashboard uses **ECharts** for advanced data visualization:

```typescript
// Chart configuration for P&L timeline
const pnlChartOption: EChartsOption = {
  title: {
    text: 'P&L Timeline',
    left: 'center'
  },
  tooltip: {
    trigger: 'axis',
    formatter: (params) => {
      const data = params[0];
      return `${data.name}<br/>
              Realized: ${data.value[1]} SOL<br/>
              Unrealized: ${data.value[2]} SOL`;
    }
  },
  legend: {
    data: ['Realized P&L', 'Unrealized P&L'],
    bottom: 10
  },
  xAxis: {
    type: 'time',
    axisLabel: {
      formatter: '{MM-dd}'
    }
  },
  yAxis: {
    type: 'value',
    axisLabel: {
      formatter: '{value} SOL'
    }
  },
  series: [
    {
      name: 'Realized P&L',
      type: 'line',
      data: realizedPnlData,
      smooth: true,
      lineStyle: { color: '#10b981' }
    },
    {
      name: 'Unrealized P&L',
      type: 'line',
      data: unrealizedPnlData,
      smooth: true,
      lineStyle: { color: '#f59e0b' }
    }
  ]
};
```

### **Responsive Design**
```typescript
// Responsive chart sizing
function useChartResponsiveness() {
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const chartRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const updateSize = () => {
      if (chartRef.current) {
        const rect = chartRef.current.getBoundingClientRect();
        setChartSize({
          width: rect.width,
          height: Math.max(400, rect.width * 0.6) // Responsive height
        });
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);
  
  return { chartRef, chartSize };
}
```

## 🎨 **Theming & Styling**

### **Theme System**
```typescript
// Theme provider with system preference detection
export function ThemeProvider({
  children,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      {children}
    </NextThemesProvider>
  );
}

// Theme toggle with smooth transitions
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      className="transition-all duration-200"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
```

### **Tailwind CSS Configuration**
```typescript
// tailwind.config.ts
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // ... more color variables
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

## 🔄 **Real-time Updates**

### **WebSocket Integration**
```typescript
// WebSocket hook for real-time updates
export function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;
    
    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLastMessage(data);
    };
    
    return () => {
      ws.close();
    };
  }, [url]);
  
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);
  
  return { isConnected, lastMessage, sendMessage };
}
```

### **Job Progress Tracking**
```typescript
// Real-time job progress component
export function JobProgressTracker({ jobId }: { jobId: string }) {
  const { progress, isConnected } = useJobProgress(jobId);
  
  if (!progress) return null;
  
  return (
    <div className="fixed bottom-4 right-4 bg-background border rounded-lg p-4 shadow-lg">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${
          isConnected ? 'bg-green-500' : 'bg-red-500'
        }`} />
        <span className="text-sm font-medium">
          {progress.currentStep}
        </span>
      </div>
      
      <div className="w-full bg-secondary rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
      
      <div className="text-xs text-muted-foreground mt-1">
        {progress.percentage}% complete
        {progress.estimatedTimeRemaining && 
          ` • ~${progress.estimatedTimeRemaining} remaining`
        }
      </div>
    </div>
  );
}
```

## 📱 **Responsive Design**

### **Mobile-First Approach**
```typescript
// Responsive layout components
export function ResponsiveGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {children}
    </div>
  );
}

// Mobile-optimized navigation
export function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setIsOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>
      
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="w-[300px]">
          <Sidebar />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

### **Breakpoint System**
```typescript
// Custom breakpoint hooks
export function useBreakpoint() {
  const [breakpoint, setBreakpoint] = useState<'sm' | 'md' | 'lg' | 'xl'>('lg');
  
  useEffect(() => {
    const updateBreakpoint = () => {
      const width = window.innerWidth;
      if (width < 640) setBreakpoint('sm');
      else if (width < 768) setBreakpoint('md');
      else if (width < 1024) setBreakpoint('lg');
      else setBreakpoint('xl');
    };
    
    updateBreakpoint();
    window.addEventListener('resize', updateBreakpoint);
    return () => window.removeEventListener('resize', updateBreakpoint);
  }, []);
  
  return breakpoint;
}
```

## 🧪 **Testing Strategy**

### **Component Testing**
```typescript
// Component test example
import { render, screen } from '@testing-library/react';
import { AccountSummaryCard } from './AccountSummaryCard';

describe('AccountSummaryCard', () => {
  it('displays wallet information correctly', () => {
    const mockData = {
      walletAddress: 'test_wallet',
      totalValue: 1000,
      change24h: 50,
      changePercent: 5,
      lastUpdated: new Date()
    };
    
    render(<AccountSummaryCard {...mockData} />);
    
    expect(screen.getByText('test_wallet')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('+$50.00 (5.00%)')).toBeInTheDocument();
  });
});
```

### **Integration Testing**
```typescript
// API integration test
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, waitFor } from '@testing-library/react';
import { WalletAnalysis } from './WalletAnalysis';

const server = setupServer(
  rest.get('/api/v1/wallets/:address/overview', (req, res, ctx) => {
    return res(
      ctx.json({
        walletAddress: req.params.address,
        totalValue: 1000,
        change24h: 50
      })
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('fetches and displays wallet data', async () => {
  render(<WalletAnalysis walletAddress="test_wallet" />);
  
  await waitFor(() => {
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
  });
});
```

## 🚀 **Performance Optimization**

### **Code Splitting**
```typescript
// Lazy loading for heavy components
const LazyChartComponent = lazy(() => import('./ChartComponent'));

export function Dashboard() {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <LazyChartComponent />
    </Suspense>
  );
}
```

### **Memoization**
```typescript
// Memoized expensive calculations
export function useMemoizedCalculation(data: any[]) {
  return useMemo(() => {
    return data.reduce((acc, item) => {
      // Expensive calculation
      return acc + complexCalculation(item);
    }, 0);
  }, [data]);
}

// Memoized components
export const MemoizedChart = memo(ChartComponent, (prevProps, nextProps) => {
  return prevProps.data === nextProps.data;
});
```

### **Bundle Optimization**
```typescript
// Dynamic imports for route-based code splitting
const SimilarityLab = dynamic(() => import('./SimilarityLab'), {
  loading: () => <SimilarityLabSkeleton />,
  ssr: false // Disable SSR for heavy components
});

// Tree shaking friendly imports
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
```

## 🔮 **Future Enhancements**

### **Planned Features**
- **Real-time Notifications**: Push notifications for analysis completion
- **Advanced Filtering**: Complex query builders for data exploration
- **Mobile App**: React Native companion app
- **Offline Support**: Service worker for offline functionality
- **Advanced Charts**: More sophisticated visualization options

### **Performance Improvements**
- **Virtual Scrolling**: For large datasets
- **Web Workers**: Background processing
- **Progressive Loading**: Incremental data loading
- **Image Optimization**: Next.js Image component integration

---

## 🎨 Frontend Architecture Implementation

### Next.js 14 App Router Implementation

**Framework Choice**: Next.js 14 with App Router for modern React development

**Key Features Utilized**:
- **Server Components**: Improved performance and SEO
- **App Router**: File-based routing with nested layouts
- **TypeScript Integration**: Full type safety across the application
- **Built-in Optimizations**: Automatic code splitting and image optimization

**Routing Structure**:
```
app/
├── layout.tsx          # Root layout with providers
├── page.tsx            # Home/dashboard page
├── wallets/
│   └── [walletAddress]/
│       └── page.tsx    # Dynamic wallet analysis
├── similarity-lab/
│   └── page.tsx        # Similarity analysis interface
└── settings/
    └── page.tsx        # User settings
```

**Trade-offs**:
- ✅ **Pros**: Modern React features, excellent performance, great developer experience
- ❌ **Cons**: Learning curve for App Router patterns, newer technology stack

### Component Library Strategy Implementation

**Technology Stack**: shadcn/ui + Tremor for comprehensive UI components

#### shadcn/ui Implementation
- **Unstyled Components**: Customizable base components
- **Accessibility**: WCAG-compliant with proper ARIA labels
- **Theme Integration**: CSS variable-based theming
- **Bundle Optimization**: Tree-shakable imports

```typescript
// Usage example
import { Button } from "@/components/ui/button";

<Button variant="default" size="lg">
  Analyze Wallet
</Button>
```

#### Tremor Integration
- **Data Visualization**: Specialized components for charts and metrics
- **Dashboard Components**: Pre-built dashboard widgets
- **Consistent Design**: Unified visual language with shadcn/ui

### State Management Implementation

**Hybrid Approach**: SWR for server state, Zustand for client state

#### SWR Configuration
```typescript
// Global SWR config (lib/swr-config.ts)
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,        // Prevent unnecessary refetches
  revalidateOnReconnect: false,    // Stable offline experience
  revalidateOnMount: true,         // Always fresh on mount
  dedupingInterval: 5000,          // 5s deduplication window
  keepPreviousData: false,         // Show loading, not stale data
  revalidateIfStale: true,         // Allow stale data updates
  refreshInterval: 0,              // No auto-refresh
};
```

#### Zustand Stores
```typescript
// API Key store
interface ApiKeyStore {
  apiKey: string | null;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  isValid: boolean;
}

// Time range store
interface TimeRangeStore {
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;
  customRange: CustomTimeRange | null;
  setCustomRange: (range: CustomTimeRange | null) => void;
}
```

#### Custom Hooks
```typescript
// Favorites management
export function useFavorites() {
  const [favorites, setFavorites] = useState<Wallet[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addFavorite = useCallback(async (walletAddress: string) => {
    // Implementation
  }, []);

  const removeFavorite = useCallback(async (walletAddress: string) => {
    // Implementation
  }, []);

  return { favorites, isLoading, addFavorite, removeFavorite };
}

// Job progress tracking
export function useJobProgress(jobId: string | null) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // WebSocket connection logic
  useEffect(() => {
    if (!jobId) return;
    const socket = new WebSocket(`ws://localhost:3001/jobs/${jobId}`);
    // Connection handling
  }, [jobId]);

  return { progress, isConnected };
}
```

**Trade-offs**:
- ✅ **Pros**: Simple, performant, excellent server state management
- ❌ **Cons**: Limited complex client state patterns, learning SWR behavior

---

## 📚 **Related Documentation**

- **[Core Analysis Engine](./../core/README.md)** - Business logic implementation
- **[Backend API](././README.md)** - REST API endpoints
- **[Database Schema](./../database/README.md)** - Data structures
- **[Deployment Guide](./../deployment/README.md)** - Production deployment
- **[Component Library](./components/README.md)** - UI component reference
